/** MIT License (c) copyright B Cavalier & J Hann */

(function (define) {
define(function (require) {
"use strict";

	var methodsToForward, syncProperties, when, map;

	when = require('when');

	map = require('../map');
	syncProperties = require('./syncProperties');

	methodsToForward = ['add', 'remove'];

	/**
	 * Sets up mediation between two collection adapters
	 * @param primary {Object} collection adapter
	 * @param secondary {Object} collection adapter
	 * @param resolver {Function} function (object, type) { returns Adapter; }
	 * @param options {Object} options
	 * @param options.bind if truthy, immediately synchronize data primary
	 *   primary secondary secondary.
	 */
	return function syncCollections (primary, secondary, resolver, options) {

		var itemMap1, itemMap2, mediationHandler1, mediationHandler2,
			watchHandler1, unwatch1, unwatch2;

		if (!options) options = {};

		// if adapter2 wants a keyFunc and doesn't have one, copy it from adapter1
		if ('symbolizer' in secondary && !secondary.symbolizer && primary.symbolizer) {
			secondary.symbolizer = primary.symbolizer;
		}
		// if adapter2 wants a comparator and doesn't have one, copy it from adapter1
		if ('comparator' in secondary && !secondary.comparator && primary.comparator) {
			secondary.comparator = primary.comparator;
		}

		// these maps keep track of items that are being watched
		itemMap1 = map.create({ symbolizer: primary.symbolizer, comparator: primary.comparator });
		itemMap2 = map.create({ symbolizer: secondary.symbolizer, comparator: secondary.comparator });

		// these functions handle any item-to-item mediation
		mediationHandler1 = createItemMediatorHandler(primary, itemMap1, resolver);
		mediationHandler2 = createItemMediatorHandler(secondary, itemMap2, resolver);

		// this function handles property changes that could affect collection order
		watchHandler1 = createItemWatcherHandler(primary, secondary, resolver);

		// TODO: This intitial sync may need to cause other operations to delay
		// until it is complete (which may happen async if secondary is async)
		if (!('sync' in options) || options.sync) {
			primary.forEach(function (item) {
				// watch for item changes
				watchHandler1(item, primary, itemMap1);
				// push item into secondary
				when(secondary.add(item), function(copy) {
					// if secondary returns a copy
					if (copy) {
						mediationHandler1(copy, item, secondary);
					}

					return copy;
				});
			});
		}

		unwatch1 = initForwarding(primary, secondary, mediationHandler1);
		unwatch2 = initForwarding(secondary, primary, mediationHandler2);

		return function () {
			itemMap1.forEach(unwatchItemData);
			itemMap2.forEach(unwatchItemData);
			unwatch1();
			unwatch2();
		};
	};

	function unwatchItemData (data) {
		if (data.unwatch) data.unwatch();
		if (data.unmediate) data.unmediate();
	}

	function createAdapter (object, resolver, type, options) {
		var Adapter = resolver(object, type);
		if (!Adapter) throw new Error('syncCollections: could not find Adapter constructor for ' + type);
		return new Adapter(object, options);
	}

	function createItemWatcherHandler (primary, secondary, resolver) {
		if (typeof primary.checkPosition == 'function' || typeof secondary.checkPosition == 'function') {
			return function watchItem (item, target, itemMap) {
				var itemData;
				itemData = itemMap.get(item);
				if (itemData) {
					// the item was already being watched
					// TODO: do we care?
					if (itemData.unwatch) itemData.unwatch();
				}
				else {
					itemData = itemMap.set(item, {
						adapter: createAdapter(item, resolver, 'object', target.getOptions())
					});
				}
				itemData.unwatch = itemData.adapter.watchAll(function (prop, value) {
					// if primary requires ordering, tell it that the item may have moved
					// TODO: if adapter returned another copy, lose previous copy, adapt this one, and start watching it
					if (typeof primary.checkPosition == 'function') primary.checkPosition(item);
					// if secondary requires ordering, tell it that the item may have moved
					// TODO: if adapter returned another copy, lose previous copy, adapt this one, and start watching it
					if (typeof secondary.checkPosition == 'function') secondary.checkPosition(item);
				});
				return itemData;
			}
		}
		else {
			return noop;
		}
	}

	function createItemMediatorHandler (sender, itemMap, resolver) {
		return function discoverItem (newItem, refItem, target) {
			var itemData, newAdapter;
			itemData = itemMap.get(refItem);
			if (itemData) {
				// the item was already being mediated
				if (itemData.unmediate) itemData.unmediate();
			}
			else {
				itemData = itemMap.set(refItem, {
					adapter: createAdapter(refItem, resolver, 'object', sender.getOptions())
				});
			}
			newAdapter = createAdapter(newItem, resolver, 'object', target.getOptions());
			itemData.unmediate = syncProperties(itemData.adapter, newAdapter);
		}
	}

	function createForwarder (method, discoveryCallback) {
		return function doForward(target, item, index) {
			return when(target[method](item, index),
				function(copy) {
					// if adapter2 returns a copy we need to propagate it
					if (copy) {
						return discoveryCallback(copy, item, target);
					}
				}
			);
		};
	}

	function createCallback (forwarder, to) {
		return function (item, index) {
			return forwarder(to, item, index);
		}
	}

	function initForwarding (from, to, discoveryCallback) {
		var forwarder, callbacks, i, len;

		callbacks = [];
		for (i = 0, len = methodsToForward.length; i < len; i++) {
			forwarder = createForwarder(methodsToForward[i], discoveryCallback);
			callbacks.push(createCallback(forwarder, to));
		}

		return from.watch.apply(from, callbacks);
	}

	function noop () {}

});
}(
	typeof define == 'function'
		? define
		: function (factory) { module.exports = factory(require); }
));
