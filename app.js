'use strict';

var _             = require('lodash'),
	host          = require('ip').address(),
	StringDecoder = require('string_decoder').StringDecoder,
	decoder       = new StringDecoder('utf8'),
	core          = require('./core')();

core.on('ready', function (options) {
	var serverAddress = host + '' + options.port;
	var server = require('./server')(options.port, host);

	server.on('ready', function () {
		process.send({
			type: 'listening'
		});
	});

	server.on('data', function (client, rawData) {
		var data = decoder.write(rawData);

		process.send({
			type: 'data',
			data: {
				server: serverAddress,
				client: client,
				data: data
			}
		});

		process.send({
			type: 'log',
			data: {
				title: 'Raw Data Received',
				description: data
			}
		});
	});

	server.on('error', function (error) {
		console.error('Server Error', error);
		process.send({
			type: 'error',
			data: {
				name: error.name,
				message: error.message,
				stack: error.stack
			}
		});
	});

	server.on('close', function () {
		process.send({
			type: 'close'
		});
	});

	server.bind();

	process.on('message', function (m) {
		if (m.type === 'message' && m.data.message) {
			var message = m.data.message;

			if (message.server === serverAddress && _.contains(_.keys(server.getClients()), message.client)) {
				server.send(message.client, message.message, function (error) {
					if (error) {
						console.log('Message Sending Error', error);
						process.send({
							type: 'error',
							data: {
								name: error.name,
								message: error.message,
								stack: error.stack
							}
						});
					}
					else {
						process.send({
							type: 'log',
							data: {
								title: 'Message Sent',
								description: message.message
							}
						});
					}
				});
			}
		}
	});
});
