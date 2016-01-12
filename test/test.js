'use strict';

const assert = require('assert');

const WebDriverPool = require('../index');

const webdriver = require('selenium-webdriver');
const WebDriver = webdriver.WebDriver;

/* global describe, it */

function basicPool() {
	return new WebDriverPool({
		count: 1
	}).ready();
}

/* eslint-disable max-nested-callbacks */

describe('WebDriverPool', () => {
	describe('#init()', () => {

		it('can build one driver', done => {
			basicPool()
			.then(pool => {
				assert.equal(pool.availableDrivers.length, 1);
				done();
				return pool.destroy();
			})
			.catch(done)
			.done();
		});
	});

	describe('#ready()', () => {
		it('Returns a promise that resolves once all drivers are build', done => {
			basicPool()
			.then(pool => {
				done();
				return pool.destroy();
			}, done)
			.done();
		});
	});

	describe('#getDriver()', () => {
		it('Returns a promise that resolves a driver', done => {
			basicPool()
			.then(pool =>
				pool.getDriver()
				.then(driver => {
					assert(driver instanceof WebDriver);
					done();
				})
				.catch(done)
				.finally(() => {
					pool.destroy();
				})
			)
			.done();
		});
	});

	describe('#returnDriver()', () => {
		it('Returns the driver back to the pool for the next in the queue to receive it', done => {
			basicPool()
			.then(pool =>
				pool.getDriver()
				.then(driver =>
					pool.returnDriver(driver)
				)
				.then(() =>
					pool.getDriver(pool)
				)
				.finally(() => {
					done();
					pool.destroy();
				})
			);
		});
	});

	describe('#checkDrivers()', () => {
		it('Does not fail', function test(done) {
			this.timeout(5500);
			basicPool().then(pool =>
				pool
				.once('health', () => { console.log('done'); pool.destroy(); done(); })
				.once('error', error => { console.error(error); pool.destroy(); done(error); })
			);
		});
	});
});
