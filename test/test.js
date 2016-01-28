'use strict';

const assert = require('assert');

const WebDriverPool = require('../index');

const webdriver = require('selenium-webdriver');
const WebDriver = webdriver.WebDriver;

/* global describe, it */

function basicPool() {
	const pool = new WebDriverPool({
		count: 1
	});
	if (process.env.VERBOSE) {
		pool.on('warn', warning => console.warn(warning))
		.on('error', error => console.error(error.stack));
	}
	return pool.ready();
}

/* eslint-disable max-nested-callbacks */

describe('WebDriverPool', () => {
	describe('#init()', () => {

		it('can build one driver', () =>
			basicPool()
			.then(pool => {
				assert.equal(pool.availableDrivers.length, 1);
				return pool.destroy();
			})
		);
	});

	describe('#ready()', () => {
		it('Returns a promise that resolves once all drivers are build', () =>
			basicPool()
			.then(pool => pool.destroy())
		);
	});

	describe('#start()', () => {
		it('Starts the pool and resolves once ready', () =>
			basicPool()
			.then(pool => pool.destroy())
		);
	});

	describe('#getDriver()', () => {
		it('Returns a promise that resolves a driver', () => {
			basicPool()
			.then(pool =>
				pool.getDriver()
				.then(driver => {
					assert(driver instanceof WebDriver);
				})
				.finally(() => {
					pool.destroy();
				})
			);
		});
	});

	describe('#returnDriver()', () => {
		it('Returns the driver back to the pool for the next in the queue to receive it', () => {
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
					pool.destroy();
				})
			);
		});

		it('Restores a driver that stopped working', function test() {
			this.timeout(8000); //eslint-disable-line no-invalid-this
			return basicPool()
			.then(pool =>
				pool.getDriver()
				.then(driver => {
					process.kill(driver.pid, 'SIGKILL');
					return pool.returnDriver(driver)
					.then(() => pool.getDriver())
					.then(driver2 => {
						assert.notEqual(driver, driver2, 'Not a new driver');
					});
				})
			);
		});
	});

	describe('#renewDriver()', () => {
		it('Creates a new driver', () => {
			let driver1;
			let pool1;
			return basicPool()
			.then(pool => { pool1 = pool; return pool.getDriver(); })
			.then(driver => { driver1 = driver; return pool1.renewDriver(driver); })
			.then(() => pool1.getDriver())
			.then(driver => {
				assert.notEqual(driver, driver1);
			})
			.finally(() => pool1.destroy());
		});
	});

	describe('#checkDrivers()', () => {
		it('Does not fail', function test(done) {
			this.timeout(5500); //eslint-disable-line no-invalid-this
			basicPool().then(pool =>
				pool
				.once('health', () => { pool.destroy(); done(); })
				.once('error', error => { pool.destroy(); done(error); })
			);
		});
	});
});
