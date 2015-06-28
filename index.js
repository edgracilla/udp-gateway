'use strict';

var _             = require('lodash'),
	host          = require('ip').address(),
	StringDecoder = require('string_decoder').StringDecoder,
	decoder       = new StringDecoder('utf8');

exports.init = function (endpointId, options, queues) {
	var taskQueue = queues.taskQueue;
	var messageQueue = queues.messageQueue;

	var serverAddress = host + '' + options.port;
	var server = require('./lib')(options.port, host);

	server.on('ready', function () {
		// TODO: Send a 'listening' event to the parent process.
	});

	server.on('data', function (client, rawData) {
		var data = decoder.write(rawData);
		var payload = {
			endpoint: endpointId,
			server: serverAddress,
			client: client,
			data: data
		};

		taskQueue.send(payload);

		// TODO: Send a 'log' event to the parent process to log the incoming data.
	});

	server.on('error', function (error) {
		// TODO: Send a 'error' event to the parent process to log the error.
	});

	server.on('close', function () {
		// TODO: Send a 'close' event to the parent process.
	});

	server.bind();

	messageQueue.subscribe(function (message) {
		console.log('Message Received.');
		console.log(message);

		if (message.server === serverAddress && _.contains(_.keys(server.getClients()), message.client)) {
			server.send(message.client, message.message);

			// TODO: Send a 'log' event to the parent process to log the message sent to the device.
		}
	});
};