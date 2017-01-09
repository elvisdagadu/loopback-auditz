'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _util = require('util');

var _auditz = require('./auditz');

var _auditz2 = _interopRequireDefault(_auditz);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

exports.default = (0, _util.deprecate)(function (app) {
  return app.loopback.modelBuilder.mixins.define('Auditz', _auditz2.default);
}, 'DEPRECATED: Use mixinSources, see https://github.com/jouke/loopback-auditz');


module.exports = exports.default;
module.exports = exports['default'];
//# sourceMappingURL=index.js.map
