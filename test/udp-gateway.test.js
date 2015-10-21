'use strict';

const PORT       = 8080,
	  CLIENT_ID1 = '567827489028375',
	  CLIENT_ID2 = '567827489028376';

var cp     = require('child_process'),
	assert = require('assert'),
	udpGateway;

describe('UDP Gateway', function () {
	this.slow(8000);

	after('terminate child process', function () {
		udpGateway.send({
			type: 'close'
		});

		setTimeout(function () {
			udpGateway.kill('SIGKILL');
		}, 4500);
	});

	describe('#spawn', function () {
		it('should spawn a child process', function () {
			assert.ok(udpGateway = cp.fork(process.cwd()), 'Child process not spawned.');
		});
	});

	describe('#handShake', function () {
		it('should notify the parent process when ready within 8 seconds', function (done) {
			this.timeout(8000);

			udpGateway.on('message', function (message) {
				if (message.type === 'ready')
					done();
			});
			console.log('Sending READY...');

			udpGateway.send({
				type: 'ready',
				data: {
					options: {
						port: PORT
					},
					devices: [{_id: CLIENT_ID1}, {_id: CLIENT_ID2}]
				}
			}, function (error) {
				assert.ifError(error);
			});
		});
	});

	describe('#message', function () {
		it('should process the message', function (done) {
			udpGateway.send({
				type: 'message',
				data: {
					client: '571826372902789',
					messageId: '55fce1455167c470abeedae2',
					message: 'TURNOFF'
				}
			}, done);
		});
	});
});