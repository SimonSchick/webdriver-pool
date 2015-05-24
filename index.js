'use strict';

var Class = require('resig-class');

var WebDriver = require('selenium-webdriver');
var Q = require('q');
var _ = require('lodash');
var util = require('util');

module.exports = Class.extend(
/** @lends  WebDriverPool.prototype */
{

	/**
	 * All functions in this object are ran in the phantomJS context
	 */
	phantom: {
		/**
		 * Sets the proxy.
		 * @param {Object} proxy
		 */
		setProxy: function(proxy) {
			/* global phantom: Object */
			phantom.setProxy(proxy.address, proxy.port, 'http', proxy.username, proxy.password);
			/* global -phantom */
			return true;
		},

		/**
		 * Function ran in the phantomjs context
		 * @param {string} userAgent
		 */
		setUserAgent: function(userAgent) {
			this.settings.userAgent = userAgent;
		},

		/**
		 * Function to fetch the process id in the phantomjs context
		 */
		getProcessId: function() {
			return require('system').pid;
		}
	},

	/**
	 * Validates that all drivers are still responsive.
	 */
	checkDrivers: function() {
		var self = this;
		_.forEach(this.availableDrivers, function(driver) {
			driver.getTitle()
			.catch (function(error) {
				console.warn('Driver has crashed, attempting to quit and restart');
				return driver.quit()
				.catch (function() {
					process.kill(driver.pid, 'SIGKILL');
				})
				.finally(function() {
					console.warn('Driver has been renewed');
					_.remove(self.availableDrivers, driver);//make a new one
					_.remove(self.drivers, driver);
					return self.buildDriver();
				});
			})
			.catch (function(error) {
				console.error(error);
			});
		});
	},

	/**
	 * @constructs WebDriverPool
	 * @param  {number} count The amount of webdrivers to keep in the pool
	 */
	init: function(settings) {

		this.settings = settings;

		this.drivers = [];
		this.availableDrivers = [];
		this.busyDrivers = [];
		this.getQueue = [];

		this.readyPromise = Q.all(_.times(settings.count || 1, function() {
			return this.buildDriver();
		}, this))
		.thenResolve(this);

		var self = this;

		setInterval(function() {
			self.checkDrivers();
		}, 5000);
	},

	/**
	 * Returns a promise that resolves when the pool is ready
	 * @public
	 * @return {Promise.<WebDriverPool>}
	 */
	ready: function() {
		return this.readyPromise;
	},

	/**
	 * Returns the path used for the web driver debug file
	 * @protected
	 * @return {string} path
	 */
	getLogFilePath: function() {
		return this.settings.logging.path + '/webdriver.log';
	},

	/**
	 * Returns the path uwhere the cookies db file should be stored
	 * @protected
	 * @return {string} pathflow
	 */
	getCookiePath: function() {
		return this.settings.storage.path + '/cookies';
	},

	/**
	 * Returns the path uwhere the cookies db file should be stored
	 * @protected
	 * @return {string} path
	 */
	getLocalStoragePath: function() {
		return this.settings.storage.path + '/localstorage';
	},

	/**
	 * Builds the actual web driver and configures it
	 * @protected
	 * @return {Promise}
	 */
	buildDriver: function() {

		var self = this;
		var settings = this.settings;

		var flow = new WebDriver.promise.ControlFlow();

		flow.on('uncaughtException', function(error) {
			console.error(error);
		});

		var builder = new WebDriver.Builder()
		.withCapabilities(this.getDriverCapabilities())
		.setControlFlow(flow);

		var driver = builder.build();

		var manage = driver.manage();
		var timeouts = manage.timeouts();
		var window = manage.window();

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
		.then(function() {
			if (settings.browser === 'phantomjs') {
				return driver.executePhantomJS(self.phantom.getProcessId)
				.then(function(pid) {
					driver.pid = pid;
				});
			}
		})
		.then(function() {
			self.drivers.push(driver);
			self.availableDrivers.push(driver);
		});
	},

	/**
	 * Builds the capabilities object required for the driver
	 * @protected
	 * @return {Promise.<webdriver.Capabilities>}
	 */
	getDriverCapabilities: function() {

		var settings = this.settings;

		var capabilities = WebDriver.Capabilities[settings.browser]();

		switch (settings.browser) {
			case 'phantomjs':
				var headerOverrides = {
					'phantomjs.page.customHeaders.Accept-Language': 'de-DE'
				};

				_.each(headerOverrides, capabilities.set, capabilities);

				var cliArgs = [
					'--webdriver-logfile='		+ this.getLogFilePath(),
					'--local-storage-path='		+ this.getLocalStoragePath(),
					'--disk-cache=true',
					'--max-disk-cache-size=16384',
					'--cookies-file='			+ this.getCookiePath(),
					'--webdriver-loglevel='		+ settings.logging.level
				];

				return capabilities.set('phantomjs.cli.args', cliArgs);
			case 'firefox':

				var proxyString = util.format(
					'%s:%s@%s:%s',
					settings.proxy.username,
					settings.proxy.password,
					settings.proxy.address,
					settings.proxy.port
				);

				return capabilities.setProxy({
					proxyType: 'manual',
					ftpProxy:	proxyString,
					httpProxy:	proxyString,
					sslProxy:	proxyString
				});
		}

		return capabilities;
	},

	/**
	 * Allocated a driver from the pool.
	 * If no drivers are available at the time the allocation will be queued.
	 * @public
	 * @return {Promise.<WebDriver>}
	 */
	getDriver: function() {
		var self = this;
		var settings = this.settings;
		var ret;
		if (this.availableDrivers.length > 0) {
			var driver = this.availableDrivers.pop();
			this.busyDrivers.push(driver);
			ret = new Q(driver);
		} else {
			var deferred = Q.defer();
			this.getQueue.push(deferred);
			ret = deferred.promise;
		}
		if (settings.browser === 'phantomjs') {
			ret = ret.then(function(driver) {
				return Q.all([
					driver.executePhantomJS(self.phantom.setUserAgent, settings.userAgent),
					driver.executePhantomJS(self.phantom.setProxy, settings.proxy)
				])
				.thenResolve(driver);
			});
		}
		return ret;
	},

	/**
	 * Returns the driver back so others may use it
	 * @public
	 * @param  {WebDriver} driver
	 */
	returnDriver: function(driver) {
		if (_.contains(this.availableDrivers, driver)) {
			throw new Error('Driver already returned');
		}
		if (!_.contains(this.drivers, driver)) {
			throw new Error('Driver does not belong to pool');
		}
		_.remove(this.busyDrivers, driver);
		this.availableDrivers.push(driver);
		var deferred = this.getQueue.pop();
		if (deferred) {
			deferred.resolve(driver);
		}
	},

	/**
	 * Destroys the pool and terminates all drivers inside of it
	 * @public
	 * @return {Promise}
	 */
	destroy: function() {
		return Q.all(_.invoke(this.drivers, 'quit'));
	}
});
