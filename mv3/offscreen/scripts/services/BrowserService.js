angular.module('myjdWebextensionApp')
    .service('BrowserService', [function () {
        function chromeErrorCallback() {
            if (mv3chrome.extension.lastError != null && mv3chrome.extension.lastError.message != null) {
                let error = mv3chrome.extension.lastError;
                console.log(error.message);
            } else if (mv3chrome.runtime.lastError != null && mv3chrome.runtime.lastError.message) {
                let error = mv3chrome.runtime.lastError;
                console.log(error.message);
            }
        }

        return {
            chromeErrorCallback: chromeErrorCallback
        }
    }]);
