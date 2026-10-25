'use strict';

angular.module('myjdWebextensionApp')
    .service('ExtensionI18nService', [
        function () {
            this.getMessage = function (msg) {
                return mv3chrome.i18n.getMessage(msg);
            };

            this.getAcceptLanguages = function () {
                return mv3chrome.i18n.getAcceptLanguages();
            };

            this.getUILanguage = function () {
                return mv3chrome.i18n.getUILanguage();
            };

            this.detectLanguage = function () {
                return mv3chrome.i18n.detectLanguage();
            }
        }]);