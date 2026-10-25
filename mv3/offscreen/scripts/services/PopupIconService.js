'use strict';

angular.module('myjdWebextensionApp')
    .service('PopupIconService', [
        function () {
            this.updateBadge = function (attributes) {
                if (attributes.color !== undefined) {
                    mv3chrome.browserAction.setBadgeBackgroundColor({color: attributes.color});
                }
                if (attributes.text !== undefined) {
                    mv3chrome.browserAction.setBadgeText({text: attributes.text});
                }
            }
        }]);