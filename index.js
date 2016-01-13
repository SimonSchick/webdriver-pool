'use strict';

const WebDriver = require('selenium-webdriver');
const Q = require('q');
const _ = require('lodash');
const util = require('util');
const EventEmitter = require('events').EventEmitter;

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
	 * Function to fetch the process id in the phantomjs context
	 */
	getProcessId() {
		return require('system').pid;
	}
};

module.exports = class WebDriverPool extends EventEmitter {

	/**
	 * Terminates a driver
	 */
	killDriver(driver) {
		return driver.quit()
		.thenCatch(error => {
			this.emit('warn', {
				message: 'Driver with pid' + driver.pid + ' is unresponsive, attempting SIGKILL',
				error: error
			});
			process.kill(driver.pid, 'SIGKILL');
		});
	}

	/**
	 * Validates that all drivers are still responsive.
	 */
	checkDrivers() {
		Q.all(this.availableDrivers.map(driver =>
			driver.getTitle()
			.thenCatch(error => {
				this.emit('warn', {
					message: 'Driver has crashed, attempting to quit and restart',
					error: error
				});
				return this.killDriver(driver)
				.finally(() => {
					this.emit('warn', {
						message: 'Driver has been renewed'
					});
					_.remove(this.availableDrivers, driver);//make a new one
					_.remove(this.drivers, driver);
					return this.buildDriver();
				});
			})
			.thenCatch(error => {
				this.emit('error', error);
			})
		))
		.then(() => this.emit('health'));
	}

	/**
	 * @constructs WebDriverPool
	 * @param  {number} count The amount of webdrivers to keep in the pool
	 */
	constructor(settings) {
		super();
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

		_.merge(this.settings, settings);

		this.drivers = [];
		this.availableDrivers = [];
		this.busyDrivers = [];
		this.getQueue = [];

		this.readyPromise = Q.all(_.times(settings.count || 1, () => this.buildDriver(), this))
		.thenResolve(this);

		this.healthInterval = setInterval(() => {
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
		return this.settings.logging.path;
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
			this.emit(error);
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
				'--disk-cache=true',
				'--max-disk-cache-size=16384'
			];
			if (settings.logging.enabled) {
				cliArgs.push('--webdriver-logfile=' + this.getLogFilePath());
				cliArgs.push('--webdriver-loglevel=' + settings.logging.level);
			}

			if (settings.storage.enabled) {
				cliArgs.push('--local-storage-path=' + this.getLocalStoragePath());
				cliArgs.push('--cookies-file=' + this.getCookiePath());
			}

			if (settings.userAgent) {
				capabilities.set('phantomjs.page.settings.userAgent', settings.userAgent);
			}

			if (this.settings.loadImages === false) {
				capabilities.set('phantomjs.page.settings.loadImages', false);
			}

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

				return Q.all(additional)
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
		const deferred = this.getQueue.pop();
		if (deferred) {
			deferred.resolve(driver);
			return;
		}
		_.remove(this.busyDrivers, driver);
		this.availableDrivers.push(driver);
	}

	/**
	 * Since some drivers are unstable, this is a way to request a renewal of the given driver.
	 * @param  {WebDriver} driver
	 * @return {Promise}
	 */
	renewDriver(driver) {
		_.remove(this.availableDrivers, driver);
		_.remove(this.drivers, driver);
		_.remove(this.busyDrivers, driver);
		return this.killDriver(driver)
		.then(() => this.buildDriver());
	}

	/**
	 * Destroys the pool and terminates all drivers inside of it
	 * @public
	 * @return {Promise}
	 */
	destroy() {
		clearInterval(this.healthInterval);
		return Q.all(_.invoke(this.drivers, 'quit'))
		.then(() => {
			this.availableDrivers = [];
			this.drivers = [];
			this.busyDrivers = [];
			this.getQueue = [];
		});
	}
};
