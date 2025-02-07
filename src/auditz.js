'use strict';

import _debug from './debug';

const assert = require('assert');

const debug = _debug();
const warn = (options, ...rest) => {
    if (!options.silenceWarnings) {
        console.warn(...rest);
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

        switch (typeof (obj1[p])) {
            //Deep compare objects
            case 'object':
                if (typeof (obj2[p]) !== 'object') return false;
                if (!Object.compare(obj1[p], obj2[p])) return false;
                break;
            //Compare function code
            case 'function':
                if (typeof (obj2[p]) === 'undefined' || (p !== 'compare' && obj1[p].toString() !== obj2[p].toString())) return false;
                break;
            //Compare values
            default:
                if (obj1[p] !== obj2[p]) return false;
        }
    }

    //Check object 2 for any extra properties
    for (var p in obj2) {
        if (typeof (obj1[p]) === 'undefined') return false;
    }
    return true;
};

export default (Model, bootOptions = {}) => {
    debug('Auditz mixin for Model %s', Model.modelName);
    let app;

    const options = Object.assign({
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
            remoteContextData: [],
        },
    }, bootOptions);

    options.revisionsModelName = (typeof options.revisions === 'object' && options.revisions.name) ? options.revisions.name : null;

    const properties = Model.definition.properties;
    const idName = Model.dataSource.idName(Model.modelName);

    let scrubbed = {};
    if (options.softDelete) {
        if (options.scrub !== false) {
            let propertiesToScrub = options.scrub;
            if (!Array.isArray(propertiesToScrub)) {
                propertiesToScrub = Object.keys(properties)
                    .filter(prop => !properties[prop][idName] && prop !== options.deletedAt && prop !== options.deletedBy);
            }
            scrubbed = propertiesToScrub.reduce((obj, prop) => ({...obj, [prop]: null}), {});
        }
    }

    if (!options.validateUpsert && Model.settings.validateUpsert) {
        Model.settings.validateUpsert = false;
        warn(options, `${Model.pluralModelName} settings.validateUpsert was overridden to false`);
    }

    if (Model.settings.validateUpsert && options.required) {
        warn(options, `Upserts for ${Model.pluralModelName} will fail when
          validation is turned on and time stamps are required`);
    }

    Model.settings.validateUpsert = options.validateUpsert;

    if (options.createdAt !== false) {
        if (typeof (properties[options.createdAt]) === 'undefined') {
            Model.defineProperty(options.createdAt, {type: Date, required: options.required, defaultFn: 'now'});
        }
    }

    if (options.updatedAt !== false) {
        if (typeof (properties[options.updatedAt]) === 'undefined') {
            Model.defineProperty(options.updatedAt, {type: Date, required: options.required});
        }
    }

    if (options.createdBy !== false) {
        if (typeof (properties[options.createdBy]) === 'undefined') {
            Model.defineProperty(options.createdBy, {type: String, required: false, mongodb: {dataType: 'ObjectID'}});
        }
    }

    if (options.updatedBy !== false) {
        if (typeof (properties[options.updatedBy]) === 'undefined') {
            Model.defineProperty(options.updatedBy, {type: String, required: false, mongodb: {dataType: 'ObjectID'}});
        }
    }

    if (options.softDelete) {
        if (typeof (properties[options.deletedAt]) === 'undefined') {
            Model.defineProperty(options.deletedAt, {type: Date, required: false, 'default': null});
        }
        if (typeof (properties[options.deletedBy]) === 'undefined') {
            Model.defineProperty(options.deletedBy, {type: String, required: false, mongodb: {dataType: 'ObjectID'}});
        }
    }

    Model.observe('after save', (ctx, next) => {
        if (!options.revisions) {
            return next();
        }
        debug('ctx.options', ctx.options);

        // determine the currently logged in user. Default to options.unknownUser
        let currentUser = options.unknownUser;


        if (ctx.options.accessToken) {
            currentUser = ctx.options.accessToken.userId;
        }

        Model.getApp((err, a) => {
            if (err) {
                return next(err);
            }
            app = a;
            let ipForwarded = '';
            let ip = '127.0.0.1';
            if (ctx.options.ip || ctx.options.ipForwarded) {
                ipForwarded = ctx.options.ipForwarded || '';
                ip = ctx.options.ip;
            }
            let groups = options.revisions.groups;

            let saveGroups = function (err) {
                if (err) {
                    next(err);
                    return;
                }
                if (groups && Array.isArray(groups)) {
                    let count = 0;
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
                let data = {
                    action: 'create',
                    table_name: Model.modelName,
                    row_id: ctx.instance.id,
                    old: null,
                    new: ctx.instance,
                    user: currentUser,
                    ip: ip,
                    ip_forwarded: ipForwarded,
                };

                //this is to allow adding data from remoting context to the revisions model
                if (options.revisions.remoteContextData && options.revisions.remoteContextData.length > 0) {
                    options.revisions.remoteContextData.forEach((property) => {
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
                            ip_forwarded: ipForwarded,
                        }, saveGroups);
                    } else if (ctx.options.oldInstances) {
                        const entries = ctx.options.oldInstances.map(inst => {
                            return {
                                action: 'delete',
                                table_name: Model.modelName,
                                row_id: inst.id,
                                old: inst,
                                new: null,
                                user: currentUser,
                                ip: ip,
                                ip_forwarded: ipForwarded,
                            };
                        });
                        app.models[options.revisionsModelName].create(entries, saveGroups);
                    } else {
                        debug('Cannot register delete without old instance! Options: %j', ctx.options);
                        return saveGroups();
                    }
                } else {
                    if (ctx.options.oldInstance && ctx.instance) {
                        const inst = ctx.instance;
                        app.models[options.revisionsModelName].create({
                            action: 'update',
                            table_name: Model.modelName,
                            row_id: inst.id,
                            old: ctx.options.oldInstance,
                            new: inst,
                            user: currentUser,
                            ip: ip,
                            ip_forwarded: ipForwarded,
                        }, saveGroups);
                    } else if (ctx.options.oldInstances) {
                        const updatedIds = ctx.options.oldInstances.map(inst => {
                            return inst.id;
                        });
                        let newInst = {};
                        const query = {where: {[idName]: {inq: updatedIds}}};
                        app.models[Model.modelName].find(query, (error, newInstances) => {
                            if (error) {
                                return next(error);
                            }
                            newInstances.forEach(inst => {
                                newInst[inst[idName]] = inst;
                            });
                            const entries = ctx.options.oldInstances.map(inst => {
                                return {
                                    action: 'update',
                                    table_name: Model.modelName,
                                    row_id: inst.id,
                                    old: inst,
                                    new: newInst[inst.id],
                                    user: currentUser,
                                    ip: ip,
                                    ip_forwarded: ipForwarded,
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
        let parts = key.split('.');

        let toObject = to;
        let fromObject = from;

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
        let data = {};
        group.properties.forEach(function (key) {
            cloneKey(key, ctx.instance, data);
        });
        debug(data);

        let rec = {
            table_name: Model.modelName,
            row_id: ctx.instance.id,
            new: data,
            user: currentUser,
            ip: ip,
            ip_forwarded: ipForwarded,
        };

        if (ctx.isNewInstance) {
            rec.action = 'create';
            rec.old = null;
            app.models[group.name].create(rec, cb);
        } else {
            rec.action = 'update';
            rec.old = ctx.options.oldInstance || null;
            if (rec.old) {
                let old = {};
                //make sure the object is pure
                group.properties.forEach(function (key) {
                    cloneKey(key, rec.old, old);
                });
                rec.old = old;
            }

            //get away from undefined properties so compare can work
            let recNew = JSON.parse(JSON.stringify(rec.new));
            let recOld = rec.old && JSON.parse(JSON.stringify(rec.old));

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
                let id = ctx.instance ? ctx.instance.id : null;
                if (!id) {
                    id = ctx.data ? ctx.data.id : null;
                }
                if (!id && ctx.where) {
                    id = ctx.where.id;
                }
                if (!id && ctx.options.remoteCtx) {
                    id = ctx.options.remoteCtx.req && ctx.options.remoteCtx.req.args ?
                        ctx.options.remoteCtx.req.args.id : null;
                }
                if (id) {
                    Model.findById(id, {deleted: true}, (err, oldInstance) => {
                        if (err) {
                            cb(err);
                        } else {
                            cb(null, oldInstance);
                        }
                    });
                } else {
                    const query = {where: ctx.where} || {};
                    Model.find(query, (err, oldInstances) => {
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

    Model.observe('before save', (ctx, next) => {
        const softDelete = ctx.options.delete;

        getOldInstance(ctx, (err, result) => {
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
            let currentUser = options.unknownUser;

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
            let keyAt = options.updatedAt;
            let keyBy = options.updatedBy;
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

            let obj;
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
            let query = where || {};
            let callback = (cb === undefined && typeof opt === 'function') ? opt : cb;
            let newOpt = {delete: true};
            if (typeof opt === 'object') {
                newOpt = {...opt, ...newOpt};
            }
            if (typeof where === 'function') {
                callback = where;
                query = {};
            }
            return Model.updateAll(query, {...scrubbed}, newOpt)
                .then(result => (typeof callback === 'function') ? callback(null, result) : result)
                .catch(error => (typeof callback === 'function') ? callback(error) : Promise.reject(error));
        };

        Model.remove = Model.destroyAll;
        Model.deleteAll = Model.destroyAll;

        Model.destroyById = function softDestroyById(id, opt, cb) {
            const callback = (cb === undefined && typeof opt === 'function') ? opt : cb;
            let newOpt = {delete: true};
            if (typeof opt === 'object') {
                newOpt = {...opt, ...newOpt};
            }

            return Model.updateAll({[idName]: id}, {...scrubbed}, newOpt)
                .then(result => (typeof callback === 'function') ? callback(null, result) : result)
                .catch(error => (typeof callback === 'function') ? callback(error) : Promise.reject(error));
        };

        Model.removeById = Model.destroyById;
        Model.deleteById = Model.destroyById;

        Model.prototype.destroy = function softDestroy(opt, cb) {
            const callback = (cb === undefined && typeof opt === 'function') ? opt : cb;

            return this.updateAttributes({...scrubbed}, {delete: true})
                .then(result => (typeof cb === 'function') ? callback(null, result) : result)
                .catch(error => (typeof cb === 'function') ? callback(error) : Promise.reject(error));
        };

        Model.prototype.remove = Model.prototype.destroy;
        Model.prototype.delete = Model.prototype.destroy;

        // Emulate default scope but with more flexibility.
        const queryNonDeleted = {[options.deletedAt]: null};

        const _findOrCreate = Model.findOrCreate;
        Model.findOrCreate = function findOrCreateDeleted(query = {}, ...rest) {
            if (!query.deleted) {
                if (!query.where || Object.keys(query.where).length === 0) {
                    query.where = queryNonDeleted;
                } else {
                    query.where = {and: [query.where, queryNonDeleted]};
                }
            }

            return _findOrCreate.call(Model, query, ...rest);
        };

        const _find = Model.find;
        Model.find = function findDeleted(query = {}, ...rest) {
            if (!query.deleted) {
                if (!query.where || Object.keys(query.where).length === 0) {
                    query.where = queryNonDeleted;
                } else {
                    query.where = {and: [query.where, queryNonDeleted]};
                }
            }

            return _find.call(Model, query, ...rest);
        };

        const _count = Model.count;
        Model.count = function countDeleted(where = {}, ...rest) {
            // Because count only receives a 'where', there's nowhere to ask for the deleted entities.
            let whereNotDeleted;
            if (!where || Object.keys(where).length === 0) {
                whereNotDeleted = queryNonDeleted;
            } else {
                whereNotDeleted = {and: [where, queryNonDeleted]};
            }
            return _count.call(Model, whereNotDeleted, ...rest);
        };

        const _update = Model.update;
        Model.update = Model.updateAll = function updateDeleted(where = {}, ...rest) {
            // Because update/updateAll only receives a 'where', there's nowhere to ask for the deleted entities.
            let whereNotDeleted;
            if (!where || Object.keys(where).length === 0) {
                whereNotDeleted = queryNonDeleted;
            } else {
                whereNotDeleted = {and: [where, queryNonDeleted]};
            }
            return _update.call(Model, whereNotDeleted, ...rest);
        };
    }

    function _setupRevisionsModel(app, opts) {
        const autoUpdate = (opts.revisions === true || (typeof opts.revisions === 'object' && opts.revisions.autoUpdate));
        const dsName = (typeof opts.revisions === 'object' && opts.revisions.dataSource) ?
            opts.revisions.dataSource : 'db';
        const rowIdType = (typeof opts.revisions === 'object' && opts.revisions.idType) ?
            opts.revisions.idType : 'Number';

        if (options.revisionsModelName) {
            _createModel(opts, dsName, autoUpdate, rowIdType, {name: options.revisionsModelName});
        }
        if (opts.revisions && typeof opts.revisions === 'object' &&
            opts.revisions.groups && opts.revisions.groups.length) {
            opts.revisions.groups.forEach(function (group) {
                if (!app.models[group.name]) {
                    _createModel(opts, dsName, autoUpdate, rowIdType, group);
                }
            });
        }
    }

    function _createModel(opts, dsName, autoUpdate, rowIdType, group) {
        const revisionsDef = require('./models/revision.json');
        let settings = {};
        for (let s in revisionsDef) {
            if (s !== 'name' && s !== 'properties') {
                settings[s] = revisionsDef[s];
            }
        }

        settings['plural'] = group.plural;

        revisionsDef.properties.row_id.type = rowIdType;

        const revisionsModel = app.dataSources[dsName].createModel(
            group.name,
            revisionsDef.properties,
            settings
        );
        const revisions = require('./models/revision')(revisionsModel, opts);

        app.model(revisions);


        if (autoUpdate) {
            // create or update the revisions table
            app.dataSources[dsName].autoupdate([group.name], (error) => {
                if (error) {
                    console.error(error);
                }
            });
        }
    }

    if (options.revisions) {
        Model.getApp((err, a) => {
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
