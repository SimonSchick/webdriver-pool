'use strict';

const WebDriver = require('selenium-webdriver');
const Q = require('q');
const _ = require('lodash');
const util = require('util');

/**
 * All functions in this object are ran in the phantomJS context
 */
const phantom = {
	/**
	 * Sets the proxy.
	 * @param {Object} proxy
	 */
	setProxy(proxy) {
		phantom.setProxy(proxy.address, proxy.port, 'http', proxy.username, proxy.password);
		return true;
	},

	/**
	 * Function ran in the phantomjs context
	 * @param {string} userAgent
	 */
	setUserAgent(userAgent) {
		this.settings.userAgent = userAgent;
	},

	/**
	 * Function to fetch the process id in the phantomjs context
	 */
	getProcessId() {
		return require('system').pid;
	}
};

module.exports = class WebDriverPool {

	/**
	 * Validates that all drivers are still responsive.
	 */
	checkDrivers() {
		_.forEach(this.availableDrivers, driver => {
			driver.getTitle()
			.catch(error => {
				console.warn('Driver has crashed, attempting to quit and restart ', error);
				return driver.quit()
				.catch(() => {
					process.kill(driver.pid, 'SIGKILL');
				})
				.finally(() => {
					console.warn('Driver has been renewed');
					_.remove(this.availableDrivers, driver);//make a new one
					_.remove(this.drivers, driver);
					return this.buildDriver();
				});
			})
			.catch(error => {
				console.error(error);
			});
		});
	}

	/**
	 * @constructs WebDriverPool
	 * @param  {number} count The amount of webdrivers to keep in the pool
	 */
	constructor(settings) {

		this.settings = {
			count: 1,
			browser: 'phantomjs',
			logging: {
				path: 'webdriverfiles',
				level: 'INFO'
			},
			storage: {
				path: 'webdriverfiles'
			},
			scriptTimeout: 15000,
			pageTimeout: 15000,
			implicitTimeout: 1500,
			viewport: {
				width: 1280,
				height: 800
			}
		};

		_.extend(this.settings, settings);

		this.drivers = [];
		this.availableDrivers = [];
		this.busyDrivers = [];
		this.getQueue = [];

		this.readyPromise = Q.all(_.times(settings.count || 1, () => this.buildDriver(), this))
		.thenResolve(this);

		setInterval(() => {
			this.checkDrivers();
		}, 5000);
	}

	/**
	 * Returns a promise that resolves when the pool is ready
	 * @public
	 * @return {Promise.<WebDriverPool>}
	 */
	ready() {
		return this.readyPromise;
	}

	/**
	 * Returns the path used for the web driver debug file
	 * @protected
	 * @return {string} path
	 */
	getLogFilePath() {
		return this.settings.logging.path + '/webdriver.log';
	}

	/**
	 * Returns the path uwhere the cookies db file should be stored
	 * @protected
	 * @return {string} pathflow
	 */
	getCookiePath() {
		return this.settings.storage.path + '/cookies';
	}

	/**
	 * Returns the path uwhere the cookies db file should be stored
	 * @protected
	 * @return {string} path
	 */
	getLocalStoragePath() {
		return this.settings.storage.path + '/localstorage';
	}

	/**
	 * Builds the actual web driver and configures it
	 * @protected
	 * @return {Promise}
	 */
	buildDriver() {

		const settings = this.settings;

		const flow = new WebDriver.promise.ControlFlow();

		flow.on('uncaughtException', error => {
			console.error(error);
		});

		const builder = new WebDriver.Builder()
		.withCapabilities(this.getDriverCapabilities())
		.setControlFlow(flow);

		const driver = builder.build();

		const manage = driver.manage();
		const timeouts = manage.timeouts();
		const window = manage.window();

		return Q.all([
			window.setPosition(0, 0),
			window.setSize(
				settings.viewport.width,
				settings.viewport.height
			),
			timeouts.setScriptTimeout(settings.scriptTimeout),
			timeouts.pageLoadTimeout(settings.pageTimeout),
			timeouts.implicitlyWait(settings.implicitTimeout)
		])
		.then(() => {
			if (settings.browser === 'phantomjs') {
				return driver.executePhantomJS(phantom.getProcessId)
				.then(pid => {
					driver.pid = pid;
				});
			}
			return 0;
		})
		.then(() => {
			this.drivers.push(driver);
			this.availableDrivers.push(driver);
		});
	}

	/**
	 * Builds the capabilities object required for the driver
	 * @protected
	 * @return {Promise.<webdriver.Capabilities>}
	 */
	getDriverCapabilities() {

		const settings = this.settings;

		const capabilities = WebDriver.Capabilities[settings.browser]();

		switch (settings.browser) {
		case 'phantomjs':
			const headerOverrides = {};

			_.each(headerOverrides, capabilities.set, capabilities);

			const cliArgs = [
				'--webdriver-logfile='		+ this.getLogFilePath(),
				'--local-storage-path='		+ this.getLocalStoragePath(),
				'--disk-cache=true',
				'--max-disk-cache-size=16384',
				'--cookies-file='			+ this.getCookiePath(),
				'--webdriver-loglevel='		+ settings.logging.level
			];

			return capabilities.set('phantomjs.cli.args', cliArgs);
		case 'firefox':

			if (settings.proxy) {
				const proxyString = util.format(
					'%s:%s@%s:%s',
					settings.proxy.username,
					settings.proxy.password,
					settings.proxy.address,
					settings.proxy.port
				);

				return capabilities.setProxy({
					proxyType: 'manual',
					ftpProxy: proxyString,
					httpProxy: proxyString,
					sslProxy: proxyString
				});
			}
		}

		return capabilities;
	}

	/**
	 * Allocated a driver from the pool.
	 * If no drivers are available at the time the allocation will be queued.
	 * @public
	 * @return {Promise.<WebDriver>}
	 */
	getDriver() {
		const settings = this.settings;
		let ret;
		if (this.availableDrivers.length > 0) {
			const driver = this.availableDrivers.pop();
			this.busyDrivers.push(driver);
			ret = new Q(driver);
		} else {
			const deferred = Q.defer();
			this.getQueue.push(deferred);
			ret = deferred.promise;
		}
		if (settings.browser === 'phantomjs') {
			ret = ret.then(driver => {
				const additional = [];
				if (this.settings.proxy) {
					additional.push(driver.executePhantomJS(phantom.setProxy, settings.proxy));
				}
				if (this.settings.userAgent) {
					additional.push(driver.executePhantomJS(phantom.setUserAgent, settings.userAgent));
				}
				Q.all(additional)
				.thenResolve(driver);
			});
		}
		return ret;
	}

	/**
	 * Returns the driver back so others may use it
	 * @public
	 * @param  {WebDriver} driver
	 */
	returnDriver(driver) {
		if (_.contains(this.availableDrivers, driver)) {
			throw new Error('Driver already returned');
		}
		if (!_.contains(this.drivers, driver)) {
			throw new Error('Driver does not belong to pool');
		}
		_.remove(this.busyDrivers, driver);
		this.availableDrivers.push(driver);
		const deferred = this.getQueue.pop();
		if (deferred) {
			deferred.resolve(driver);
		}
	}

	/**
	 * Destroys the pool and terminates all drivers inside of it
	 * @public
	 * @return {Promise}
	 */
	destroy() {
		return Q.all(_.invoke(this.drivers, 'quit'));
	}
};
