# webdriver-pool

For simple example usage, please see the test folder.

## constructor(Object settings)
Default settings:
```javascript
{
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
}
```
All settings: 
```javascript
{
	count: NUMBER,
	browser: STRING(phantomjs|firefox|chromium),
	logging: {
		path: STRING,
		level: STRING(please see here https://selenium.googlecode.com/git/docs/api/javascript/enum_webdriver_logging_Level.html)
	},
	storage: {
		path: STRING
	},
	scriptTimeout: NUMBER milliseconds,
	pageTimeout: NUMBER milliseconds,
	implicitTimeout: NUMBER milliseconds,
	viewport: {
		width: NUMBER pixels,
		height: NUMBER pixels
	},
	proxy: { // Only with firefox and phantomjs
		username: STRING,
		password: STRING,
		address: STRING,
		port: STRING/NUMBER
	},
	userAgent: STRING, // only works with phantomjs
	loadImages: boolean // only works with phantomjs
}
```

#Promise ready
Promise that will resolve once the pool is set up.

#Promise<WebDriver> getDriver()
Request a driver from the pool, will queue if all drivers are busy.

#returnDriver(WebDriver)
Should be called when the driver is no longer needed, makes it available for other operations.

#Promise destroy()
Kills all drivers, do not use object after calling this method.
