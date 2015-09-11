'use strict';

var dgram        = require('dgram'),
	inherits     = require('util').inherits,
	EventEmitter = require('events').EventEmitter;

function Server(socketType) {
	if (!(this instanceof Server)) {
		return new Server(socketType);
	}

	EventEmitter.call(this);
	Server.init.call(this, socketType);
}

inherits(Server, EventEmitter);

Server.init = function (socketType) {
	var self = this;

	self._clients = {};
	socketType = socketType || 'udp4';

	self._server = dgram.createSocket(socketType);

	function handler(message, requestInfo) {
		var client = requestInfo.address + ':' + requestInfo.port;
		self._clients[client] = {
			host: requestInfo.address,
			port: requestInfo.port
		};

		self.emit('data', client, message.toString().replace(/\n$/, ''));
	}

	var listening = function () {
		self.emit('ready');
	};

	var close = function () {
		self.emit('close');
	};

	var error = function (err) {
		self.emit('error', err);
	};

	process.nextTick(function register() {
		self._server.on('listening', listening);
		self._server.on('message', handler);
		self._server.on('close', close);
		self._server.on('error', error);
	}, this);
};

Server.prototype.send = function (client, message, callback) {
	callback = callback || function () {
		};

	if (!Buffer.isBuffer(message))
		message = new Buffer(message.toString() + '\n');

	if (this._clients[client]) {
		var clientObj = this._clients[client];

		this._server.send(message, 0, message.length, clientObj.port, clientObj.host, callback);
	}
	else
		callback();
};

Server.prototype.getClients = function () {
	return this._clients;
};

Server.prototype.close = function (callback) {
	this._server.close();
	callback();
};

Server.prototype.listen = function (port, host, callback) {
	callback = callback || function () {
		};

	this._server.bind(port, host, callback);
};

module.exports = Server;
