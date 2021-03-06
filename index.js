'use strict';

const WebDriver = require('selenium-webdriver');
const Q = require('q');
const _ = require('lodash');
const util = require('util');
const EventEmitter = require('events').EventEmitter;

const WPromise = WebDriver.promise.Promise.prototype;
WPromise.catch = WPromise.thenCatch;
WPromise.finally = function fin(handler) { //eslint-disable-line prefer-arrow
	return this.then(val => handler(val),
	error => handler(error));
};

/**
 * All functions in this object are ran in the phantomJS context
 */
const phantom = {
	/**
	 * Sets the proxy.
	 * @param {Object} proxy
	 */
	setProxy: `var proxy = arguments[0];
	phantom.setProxy(proxy.address, proxy.port, 'http', proxy.username, proxy.password);
	`,

	/**
	 * Function to fetch the process id in the phantomjs context
	 */
	getProcessId: 'return require(\'system\').pid;'
};

/* eslint-disable max-len */
/**
 * @external {WebDriver} https://selenium.googlecode.com/git/docs/api/javascript/module_selenium-webdriver_class_WebDriver.html
 */
/* eslint-enable max-len */

function fixupSyncThrow(subject, call) {
	try {
		return subject[call](); //May throw sync, BAD google.
	} catch (error) {
		return Q.reject(error);
	}
}

module.exports = class WebDriverPool extends EventEmitter {

	/**
	 * Terminates a driver
	 * @param {WebDriver} driver The driver to be killed.
	 * @return {Promise} Resolves when the driver was killed.
	 */
	killDriver(driver) {
		return fixupSyncThrow(driver, 'quit')
		.catch(error => {
			if (driver.pid) {
				this.emit('warn', {
					message: 'Driver with pid' + driver.pid + ' is unresponsive, attempting SIGKILL',
					error
				});
				try {
					process.kill(driver.pid, 'SIGKILL');
				} catch (error) {
					this.emit('warn', {
						message: 'Driver with id ' + driver.pid + ' is already terminated',
						error
					});
				}
				return;
			}
			throw error;
		});
	}

	/**
	 * Validates that all drivers are still responsive, renews it if it becomes unresponsive.
	 * @private
	 * @param {WebDriver} driver The driver to be checked.
	 * @return {Promise.<{status: boolean, driver: !WebDriver}>} When the check fails the
	 * promise will resolve an object with a new driver and status false.
	 * Otherwise only status being true.
	 */
	checkSingleDriver(driver) {
		return fixupSyncThrow(driver, 'getTitle')
		.then(() => ({status: true}), error => {
			this.emit('warn', {
				message: 'Driver has crashed, attempting to quit and restart',
				error
			});
			return this.renewDriver(driver)
			.then(driver => {
				this.emit('warn', {
					message: 'Driver has been renewed'
				});
				return {
					status: false,
					driver
				};
			});
		});
	}

	/**
	 * Validates that all drivers are still responsive.
	 */
	checkDrivers() {
		Q.all(this.availableDrivers.map(driver =>
			this.checkSingleDriver(driver)
		))
		.finally(() => this.emit('health'));
	}

	/**
	 * @param  {Object} settings The settings for the drivers.
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

		this.start();
	}

	/**
	 * Starts the drivers and heartbeat check.
	 * @public
	 * @return {Promise} Resolves when ready.
	 */
	start() {
		if (this.readyPromise) {
			return this.readyPromise;
		}
		this.healthInterval = setInterval(() => {
			this.checkDrivers();
		}, 5000);

		this.readyPromise = Q.all(_.times(this.settings.count || 1, () => this.buildDriver(), this))
		.thenResolve(this);
		return this.readyPromise;
	}

	/**
	 * Returns a promise that resolves when the pool is ready
	 * @public
	 * @deprecated Currently the constructor launches webdriver instances, in the future you'll
	 * need to call this [start]@link{start} instead.
	 * @return {Promise.<WebDriverPool>} Resolves when the pool is ready.
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
	 * @return {Promise.<WebDriver>} Resolves the newly created driver.
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
			return driver;
		});
	}

	/**
	 * Builds the capabilities object required for the driver
	 * @protected
	 * @return {Promise.<webdriver.Capabilities>} Resolves the wanted capabilities.
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
	 * Allocates a driver from the pool.
	 * If no drivers are available at the time the allocation will be queued.
	 * @public
	 * @return {Promise.<WebDriver>} Resolves a driver once one is available.
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
	 * @param  {WebDriver} driver The driver to be returned.
	 * @return {Promise} Resolves once the driver has been returned and a health check was run.
	 */
	returnDriver(driver) {
		if (_.contains(this.availableDrivers, driver)) {
			throw new Error('Driver already returned');
		}
		if (!_.contains(this.drivers, driver)) {
			throw new Error('Driver does not belong to pool');
		}
		return this.checkSingleDriver(driver)
		.then(report => {
			if (report.status) {
				const deferred = this.getQueue.pop();
				if (deferred) {
					deferred.resolve(driver);
					return;
				}
				_.remove(this.busyDrivers, driver);
				this.availableDrivers.push(driver);
			} else {
				const deferred = this.getQueue.pop();
				if (deferred) {
					deferred.resolve(report.driver);
				}
			}

		});
	}

	/**
	 * Since some drivers are unstable, this is a way to request a renewal of the given driver.
	 * @param  {WebDriver} driver The driver to be renewed.
	 * @return {Promise.<WebDriver>} Resolves a replacement driver.
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
	 * @return {Promise} Resolves once all drivers have terminated.
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
