'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _promise = require('babel-runtime/core-js/promise');

var _promise2 = _interopRequireDefault(_promise);

var _stringify = require('babel-runtime/core-js/json/stringify');

var _stringify2 = _interopRequireDefault(_stringify);

var _defineProperty2 = require('babel-runtime/helpers/defineProperty');

var _defineProperty3 = _interopRequireDefault(_defineProperty2);

var _keys = require('babel-runtime/core-js/object/keys');

var _keys2 = _interopRequireDefault(_keys);

var _extends3 = require('babel-runtime/helpers/extends');

var _extends4 = _interopRequireDefault(_extends3);

var _typeof2 = require('babel-runtime/helpers/typeof');

var _typeof3 = _interopRequireDefault(_typeof2);

var _debug2 = require('./debug');

var _debug3 = _interopRequireDefault(_debug2);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var assert = require('assert');

var debug = (0, _debug3.default)();
var warn = function warn(options) {
  for (var _len = arguments.length, rest = Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) {
    rest[_key - 1] = arguments[_key];
  }

  if (!options.silenceWarnings) {
    var _console;

    (_console = console).warn.apply(_console, rest);
  }
};

Object.compare = function (obj1, obj2) {
  //Loop through properties in object 1
  for (var p in obj1) {
    //Check property exists on both objects
    if (obj1.hasOwnProperty(p) !== obj2.hasOwnProperty(p)) return false;
    if (obj1[p] === null || obj2[p] === null) {
      return obj1[p] === obj2[p];
    }

    switch ((0, _typeof3.default)(obj1[p])) {
      //Deep compare objects
      case 'object':
        if ((0, _typeof3.default)(obj2[p]) !== 'object') return false;
        if (!Object.compare(obj1[p], obj2[p])) return false;
        break;
      //Compare function code
      case 'function':
        if (typeof obj2[p] === 'undefined' || p !== 'compare' && obj1[p].toString() !== obj2[p].toString()) return false;
        break;
      //Compare values
      default:
        if (obj1[p] !== obj2[p]) return false;
    }
  }

  //Check object 2 for any extra properties
  for (var p in obj2) {
    if (typeof obj1[p] === 'undefined') return false;
  }
  return true;
};

exports.default = function (Model) {
  var bootOptions = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};

  debug('Auditz mixin for Model %s', Model.modelName);
  var app = void 0;

  var options = (0, _extends4.default)({
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    deletedAt: 'deletedAt',
    createdBy: 'createdBy',
    updatedBy: 'updatedBy',
    deletedBy: 'deletedBy',
    softDelete: true,
    unknownUser: '0',
    scrub: false,
    required: true,
    validateUpsert: false, // default to turning validation off
    silenceWarnings: false,
    revisions: {
      name: 'revisions',
      idType: 'Number',
      dataSource: 'db',
      autoUpdate: true,
      remoteContextData: []
    }
  }, bootOptions);

  options.revisionsModelName = (0, _typeof3.default)(options.revisions) === 'object' && options.revisions.name ? options.revisions.name : null;
  debug('options', options);

  var properties = Model.definition.properties;
  var idName = Model.dataSource.idName(Model.modelName);

  var scrubbed = {};
  if (options.softDelete) {
    if (options.scrub !== false) {
      var propertiesToScrub = options.scrub;
      if (!Array.isArray(propertiesToScrub)) {
        propertiesToScrub = (0, _keys2.default)(properties).filter(function (prop) {
          return !properties[prop][idName] && prop !== options.deletedAt && prop !== options.deletedBy;
        });
      }
      scrubbed = propertiesToScrub.reduce(function (obj, prop) {
        return (0, _extends4.default)({}, obj, (0, _defineProperty3.default)({}, prop, null));
      }, {});
    }
  }

  if (!options.validateUpsert && Model.settings.validateUpsert) {
    Model.settings.validateUpsert = false;
    warn(options, Model.pluralModelName + ' settings.validateUpsert was overridden to false');
  }

  if (Model.settings.validateUpsert && options.required) {
    warn(options, 'Upserts for ' + Model.pluralModelName + ' will fail when\n          validation is turned on and time stamps are required');
  }

  Model.settings.validateUpsert = options.validateUpsert;

  if (options.createdAt !== false) {
    if (typeof properties[options.createdAt] === 'undefined') {
      Model.defineProperty(options.createdAt, { type: Date, required: options.required, defaultFn: 'now' });
    }
  }

  if (options.updatedAt !== false) {
    if (typeof properties[options.updatedAt] === 'undefined') {
      Model.defineProperty(options.updatedAt, { type: Date, required: options.required });
    }
  }

  if (options.createdBy !== false) {
    if (typeof properties[options.createdBy] === 'undefined') {
      Model.defineProperty(options.createdBy, { type: String, required: false });
    }
  }

  if (options.updatedBy !== false) {
    if (typeof properties[options.updatedBy] === 'undefined') {
      Model.defineProperty(options.updatedBy, { type: String, required: false });
    }
  }

  if (options.softDelete) {
    if (typeof properties[options.deletedAt] === 'undefined') {
      Model.defineProperty(options.deletedAt, { type: Date, required: false, 'default': null });
    }
    if (typeof properties[options.deletedBy] === 'undefined') {
      Model.defineProperty(options.deletedBy, { type: String, required: false });
    }
  }

  Model.observe('after save', function (ctx, next) {
    if (!options.revisions) {
      return next();
    }
    debug('ctx.options', ctx.options);

    // determine the currently logged in user. Default to options.unknownUser
    var currentUser = options.unknownUser;

    if (ctx.options.accessToken) {
      currentUser = ctx.options.accessToken.userId;
    }

    Model.getApp(function (err, a) {
      if (err) {
        return next(err);
      }
      app = a;
      var ipForwarded = '';
      var ip = '127.0.0.1';
      if (ctx.options.ip || ctx.options.ipForwarded) {
        ipForwarded = ctx.options.ipForwarded || '';
        ip = ctx.options.ip;
      }
      var groups = options.revisions.groups;

      var saveGroups = function saveGroups(err) {
        if (err) {
          next(err);
          return;
        }
        if (groups && Array.isArray(groups)) {
          var count = 0;
          if (!(ctx.options && ctx.options.delete)) {
            groups.forEach(function (group) {
              createOrUpdateRevision(ctx, group, currentUser, ipForwarded, ip, function () {
                count += 1;
                if (count === groups.length) {
                  next();
                }
              });
            });
            return;
          }
        }
        next();
      };

      // If it's a new instance, set the createdBy to currentUser
      if (ctx.isNewInstance) {
        var data = {
          action: 'create',
          table_name: Model.modelName,
          row_id: ctx.instance.id,
          old: null,
          new: ctx.instance,
          user: currentUser,
          ip: ip,
          ip_forwarded: ipForwarded
        };

        //this is to allow adding data from remoting context to the revisions model
        if (options.revisions.remoteContextData && options.revisions.remoteContextData.length > 0) {
          options.revisions.remoteContextData.forEach(function (property) {
            if (ctx.options[property]) {
              data[property] = ctx.options[property];
            }
          });
        }

        app.models[options.revisionsModelName].create(data, saveGroups);
      } else {
        if (ctx.options && ctx.options.delete) {
          if (ctx.options.oldInstance) {
            app.models[options.revisionsModelName].create({
              action: 'delete',
              table_name: Model.modelName,
              row_id: ctx.options.oldInstance.id,
              old: ctx.options.oldInstance,
              new: null,
              user: currentUser,
              ip: ip,
              ip_forwarded: ipForwarded
            }, saveGroups);
          } else if (ctx.options.oldInstances) {
            var entries = ctx.options.oldInstances.map(function (inst) {
              return {
                action: 'delete',
                table_name: Model.modelName,
                row_id: inst.id,
                old: inst,
                new: null,
                user: currentUser,
                ip: ip,
                ip_forwarded: ipForwarded
              };
            });
            app.models[options.revisionsModelName].create(entries, saveGroups);
          } else {
            debug('Cannot register delete without old instance! Options: %j', ctx.options);
            return saveGroups();
          }
        } else {
          if (ctx.options.oldInstance && ctx.instance) {
            var inst = ctx.instance;
            app.models[options.revisionsModelName].create({
              action: 'update',
              table_name: Model.modelName,
              row_id: inst.id,
              old: ctx.options.oldInstance,
              new: inst,
              user: currentUser,
              ip: ip,
              ip_forwarded: ipForwarded
            }, saveGroups);
          } else if (ctx.options.oldInstances) {
            var updatedIds = ctx.options.oldInstances.map(function (inst) {
              return inst.id;
            });
            var newInst = {};
            var query = { where: (0, _defineProperty3.default)({}, idName, { inq: updatedIds }) };
            app.models[Model.modelName].find(query, function (error, newInstances) {
              if (error) {
                return next(error);
              }
              newInstances.forEach(function (inst) {
                newInst[inst[idName]] = inst;
              });
              var entries = ctx.options.oldInstances.map(function (inst) {
                return {
                  action: 'update',
                  table_name: Model.modelName,
                  row_id: inst.id,
                  old: inst,
                  new: newInst[inst.id],
                  user: currentUser,
                  ip: ip,
                  ip_forwarded: ipForwarded
                };
              });
              app.models[options.revisionsModelName].create(entries, saveGroups);
            });
          } else {
            debug('Cannot register update without old and new instance. Options: %j', ctx.options);
            debug('instance: %j', ctx.instance);
            debug('data: %j', ctx.data);
            return saveGroups();
          }
        }
      }
    });
  });

  function cloneKey(key, from, to) {
    var parts = key.split('.');

    var toObject = to;
    var fromObject = from;

    parts.forEach(function (key, index) {
      if (index === parts.length - 1) {
        toObject[key] = fromObject && fromObject[key];
      } else {
        if (!toObject[key]) {
          toObject[key] = {};
        }
      }

      fromObject = fromObject && fromObject[key];
      toObject = toObject[key];
    });
  }

  function createOrUpdateRevision(ctx, group, currentUser, ipForwarded, ip, cb) {
    var data = {};
    group.properties.forEach(function (key) {
      cloneKey(key, ctx.instance, data);
    });
    debug(data);

    var rec = {
      table_name: Model.modelName,
      row_id: ctx.instance.id,
      new: data,
      user: currentUser,
      ip: ip,
      ip_forwarded: ipForwarded
    };

    if (ctx.isNewInstance) {
      rec.action = 'create';
      rec.old = null;
      app.models[group.name].create(rec, cb);
    } else {
      rec.action = 'update';
      rec.old = ctx.options.oldInstance || null;
      if (rec.old) {
        var old = {};
        //make sure the object is pure
        group.properties.forEach(function (key) {
          cloneKey(key, rec.old, old);
        });
        rec.old = old;
      }

      //get away from undefined properties so compare can work
      var recNew = JSON.parse((0, _stringify2.default)(rec.new));
      var recOld = rec.old && JSON.parse((0, _stringify2.default)(rec.old));

      if (rec.old && Object.compare(recNew, recOld)) {
        console.log('equal ' + group.name);
        return cb();
      }
      app.models[group.name].create(rec, cb);
    }
  }

  function getOldInstance(ctx, cb) {
    if (options.revisions) {
      if (typeof ctx.isNewInstance === 'undefined' || !ctx.isNewInstance) {
        var id = ctx.instance ? ctx.instance.id : null;
        if (!id) {
          id = ctx.data ? ctx.data.id : null;
        }
        if (!id && ctx.where) {
          id = ctx.where.id;
        }
        if (!id && ctx.options.remoteCtx) {
          id = ctx.options.remoteCtx.req && ctx.options.remoteCtx.req.args ? ctx.options.remoteCtx.req.args.id : null;
        }
        if (id) {
          Model.findById(id, { deleted: true }, function (err, oldInstance) {
            if (err) {
              cb(err);
            } else {
              cb(null, oldInstance);
            }
          });
        } else {
          var query = { where: ctx.where } || {};
          Model.find(query, function (err, oldInstances) {
            if (err) {
              cb(err);
            } else {
              if (oldInstances.length > 1) {
                return cb(null, oldInstances);
              } else if (oldInstances.length === 0) {
                return cb();
              }
              cb(null, oldInstances[0]);
            }
          });
        }
      } else {
        cb();
      }
    } else {
      cb();
    }
  }

  Model.observe('before save', function (ctx, next) {
    var softDelete = ctx.options.delete;

    getOldInstance(ctx, function (err, result) {
      if (err) {
        console.error(err);
        return next(err);
      }

      if (Array.isArray(result)) {
        ctx.options.oldInstances = result;
      } else {
        ctx.options.oldInstance = result;
      }
      // determine the currently logged in user. Default to options.unknownUser
      var currentUser = options.unknownUser;

      if (ctx.options.accessToken) {
        currentUser = ctx.options.accessToken.userId;
      }

      // If it's a new instance, set the createdBy to currentUser
      if (ctx.isNewInstance) {
        debug('Setting %s.%s to %s', ctx.Model.modelName, options.createdBy, currentUser);
        ctx.instance[options.createdBy] = currentUser;
        if (options.softDelete) {
          ctx.instance[options.deletedAt] = null;
        }
      } else {
        // if the createdBy and createdAt are sent along in the data to save, remove the keys
        // as we don't want to let the user overwrite it
        if (ctx.instance) {
          delete ctx.instance[options.createdBy];
          delete ctx.instance[options.createdAt];
        } else {
          delete ctx.data[options.createdBy];
          delete ctx.data[options.createdAt];
        }
      }

      if (ctx.options && ctx.options.skipUpdatedAt) {
        return next();
      }
      var keyAt = options.updatedAt;
      var keyBy = options.updatedBy;
      if (options.softDelete) {
        // Since soft deletes replace the actual delete by an update, we set the option
        // 'delete' in the overridden delete functions that perform updates.
        // We now have to determine if we need to set updatedAt/updatedBy or
        // deletedAt/deletedBy
        if (softDelete) {
          keyAt = options.deletedAt;
          keyBy = options.deletedBy;
        }
      }

      var obj = void 0;
      if (ctx.instance) {
        obj = ctx.instance;
      } else {
        obj = ctx.data;
      }

      if (keyAt !== false) {
        obj[keyAt] = new Date();
      }
      if (keyBy !== false) {
        obj[keyBy] = currentUser;
      }

      return next();
    });
  });

  if (options.softDelete) {
    Model.destroyAll = function softDestroyAll(where, opt, cb) {
      var query = where || {};
      var callback = cb === undefined && typeof opt === 'function' ? opt : cb;
      var newOpt = { delete: true };
      if ((typeof opt === 'undefined' ? 'undefined' : (0, _typeof3.default)(opt)) === 'object') {
        newOpt = (0, _extends4.default)({}, opt, newOpt);
      }
      if (typeof where === 'function') {
        callback = where;
        query = {};
      }
      return Model.updateAll(query, (0, _extends4.default)({}, scrubbed), newOpt).then(function (result) {
        return typeof callback === 'function' ? callback(null, result) : result;
      }).catch(function (error) {
        return typeof callback === 'function' ? callback(error) : _promise2.default.reject(error);
      });
    };

    Model.remove = Model.destroyAll;
    Model.deleteAll = Model.destroyAll;

    Model.destroyById = function softDestroyById(id, opt, cb) {
      var callback = cb === undefined && typeof opt === 'function' ? opt : cb;
      var newOpt = { delete: true };
      if ((typeof opt === 'undefined' ? 'undefined' : (0, _typeof3.default)(opt)) === 'object') {
        newOpt = (0, _extends4.default)({}, opt, newOpt);
      }

      return Model.updateAll((0, _defineProperty3.default)({}, idName, id), (0, _extends4.default)({}, scrubbed), newOpt).then(function (result) {
        return typeof callback === 'function' ? callback(null, result) : result;
      }).catch(function (error) {
        return typeof callback === 'function' ? callback(error) : _promise2.default.reject(error);
      });
    };

    Model.removeById = Model.destroyById;
    Model.deleteById = Model.destroyById;

    Model.prototype.destroy = function softDestroy(opt, cb) {
      var callback = cb === undefined && typeof opt === 'function' ? opt : cb;

      return this.updateAttributes((0, _extends4.default)({}, scrubbed), { delete: true }).then(function (result) {
        return typeof cb === 'function' ? callback(null, result) : result;
      }).catch(function (error) {
        return typeof cb === 'function' ? callback(error) : _promise2.default.reject(error);
      });
    };

    Model.prototype.remove = Model.prototype.destroy;
    Model.prototype.delete = Model.prototype.destroy;

    // Emulate default scope but with more flexibility.
    var queryNonDeleted = (0, _defineProperty3.default)({}, options.deletedAt, null);

    var _findOrCreate = Model.findOrCreate;
    Model.findOrCreate = function findOrCreateDeleted() {
      var query = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};

      if (!query.deleted) {
        if (!query.where || (0, _keys2.default)(query.where).length === 0) {
          query.where = queryNonDeleted;
        } else {
          query.where = { and: [query.where, queryNonDeleted] };
        }
      }

      for (var _len2 = arguments.length, rest = Array(_len2 > 1 ? _len2 - 1 : 0), _key2 = 1; _key2 < _len2; _key2++) {
        rest[_key2 - 1] = arguments[_key2];
      }

      return _findOrCreate.call.apply(_findOrCreate, [Model, query].concat(rest));
    };

    var _find = Model.find;
    Model.find = function findDeleted() {
      var query = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};

      if (!query.deleted) {
        if (!query.where || (0, _keys2.default)(query.where).length === 0) {
          query.where = queryNonDeleted;
        } else {
          query.where = { and: [query.where, queryNonDeleted] };
        }
      }

      for (var _len3 = arguments.length, rest = Array(_len3 > 1 ? _len3 - 1 : 0), _key3 = 1; _key3 < _len3; _key3++) {
        rest[_key3 - 1] = arguments[_key3];
      }

      return _find.call.apply(_find, [Model, query].concat(rest));
    };

    var _count = Model.count;
    Model.count = function countDeleted() {
      var where = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};

      // Because count only receives a 'where', there's nowhere to ask for the deleted entities.
      var whereNotDeleted = void 0;
      if (!where || (0, _keys2.default)(where).length === 0) {
        whereNotDeleted = queryNonDeleted;
      } else {
        whereNotDeleted = { and: [where, queryNonDeleted] };
      }

      for (var _len4 = arguments.length, rest = Array(_len4 > 1 ? _len4 - 1 : 0), _key4 = 1; _key4 < _len4; _key4++) {
        rest[_key4 - 1] = arguments[_key4];
      }

      return _count.call.apply(_count, [Model, whereNotDeleted].concat(rest));
    };

    var _update = Model.update;
    Model.update = Model.updateAll = function updateDeleted() {
      var where = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};

      // Because update/updateAll only receives a 'where', there's nowhere to ask for the deleted entities.
      var whereNotDeleted = void 0;
      if (!where || (0, _keys2.default)(where).length === 0) {
        whereNotDeleted = queryNonDeleted;
      } else {
        whereNotDeleted = { and: [where, queryNonDeleted] };
      }

      for (var _len5 = arguments.length, rest = Array(_len5 > 1 ? _len5 - 1 : 0), _key5 = 1; _key5 < _len5; _key5++) {
        rest[_key5 - 1] = arguments[_key5];
      }

      return _update.call.apply(_update, [Model, whereNotDeleted].concat(rest));
    };
  }

  function _setupRevisionsModel(app, opts) {
    var autoUpdate = opts.revisions === true || (0, _typeof3.default)(opts.revisions) === 'object' && opts.revisions.autoUpdate;
    var dsName = (0, _typeof3.default)(opts.revisions) === 'object' && opts.revisions.dataSource ? opts.revisions.dataSource : 'db';
    var rowIdType = (0, _typeof3.default)(opts.revisions) === 'object' && opts.revisions.idType ? opts.revisions.idType : 'Number';

    if (options.revisionsModelName) {
      _createModel(opts, dsName, autoUpdate, rowIdType, { name: options.revisionsModelName });
    }
    if (opts.revisions && (0, _typeof3.default)(opts.revisions) === 'object' && opts.revisions.groups && opts.revisions.groups.length) {
      opts.revisions.groups.forEach(function (group) {
        if (!app.models[group.name]) {
          _createModel(opts, dsName, autoUpdate, rowIdType, group);
        }
      });
    }
  }

  function _createModel(opts, dsName, autoUpdate, rowIdType, group) {
    var revisionsDef = require('./models/revision.json');
    var settings = {};
    for (var s in revisionsDef) {
      if (s !== 'name' && s !== 'properties') {
        settings[s] = revisionsDef[s];
      }
    }

    settings['plural'] = group.plural;

    revisionsDef.properties.row_id.type = rowIdType;

    var revisionsModel = app.dataSources[dsName].createModel(group.name, revisionsDef.properties, settings);
    var revisions = require('./models/revision')(revisionsModel, opts);

    app.model(revisions);

    if (autoUpdate) {
      // create or update the revisions table
      app.dataSources[dsName].autoupdate([group.name], function (error) {
        if (error) {
          console.error(error);
        }
      });
    }
  }

  if (options.revisions) {
    Model.getApp(function (err, a) {
      if (err) {
        return console.error(err);
      }
      app = a;
      if (!app.models[options.revisionsModelName]) {
        _setupRevisionsModel(app, options);
      }
    });
  }
};

module.exports = exports['default'];
//# sourceMappingURL=auditz.js.map
