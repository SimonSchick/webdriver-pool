'use strict';

var assert = require('assert'); // node.js core module

var WebDriverPool = require('../index');

var webdriver = require('selenium-webdriver');
var WebDriver = webdriver.WebDriver;

/* global describe, it */

function basicPool() {
	return new WebDriverPool({
				count: 1
			}).ready();
}

describe('WebDriverPool', function() {
	describe('#init()', function() {

		it('can build one driver', function(done) {
			basicPool()
			.then(function(pool) {
				assert.equal(pool.availableDrivers.length, 1);
				done();
				return pool.destroy();
			})
			.catch(done)
			.done();
		});
	});

	describe('#ready()', function() {
		it('Returns a promise that resolves once all drivers are build', function(done) {
			basicPool()
			.then(function(pool) {
				done();
				return pool.destroy();
			}, done)
			.done();
		});
	});

	describe('#getDriver()', function() {
		it('Returns a promise that resolves a driver', function(done) {
			basicPool()
			.then(function(pool) {
				return pool.getDriver()
					.then(function(driver) {
					assert(driver instanceof WebDriver);
					done();
				})
				.catch(done)
				.finally(function() {
					pool.destroy();
				});
			})
			.done();
		});
	});

	describe('#returnDriver()', function() {
		it('Returns the driver back to the pool for the next in the queue to receive it', function(done) {
			basicPool()
			.then(function(pool) {
				return pool.getDriver()
				.then(function(driver) {
					return pool.returnDriver(driver);
				})
				.then(function(driver) {
					return pool.getDriver(pool);
				})
				.then(function() {
					done();
				}, done)
				.finally(function() {
					pool.destroy();
				});
			});
		});
	});

});
