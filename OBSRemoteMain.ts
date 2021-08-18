import OBSWebSocket from 'obs-websocket-js';
import { ipcMain } from 'electron';

import TTVSTMain from '../../dist/dev.pakl.ttvst/main/TTVSTMain';
import winston from 'winston';

declare var TTVST: TTVSTMain;
const { BroadcastMain } = TTVST;
declare var logger: winston.Logger;

let disconnectedButtons = [{ icon: 'PlugConnected', action: 'app.ttvst.obs.connect', title: 'Connect' }];
let connectedButtons = [{ icon: 'PlugDisconnected', action: 'app.ttvst.obs.disconnect', title: 'Disconnect' }];

const OBSTriggers = {
	'app.ttvst.obs.event.switchscenes': {e:'SwitchScenes', a:['scene-name']},
	'app.ttvst.obs.event.streamstarted': {e:'StreamStarted', a:[]},
	'app.ttvst.obs.event.streamstopped': {e:'StreamStopped', a:[]},
	'app.ttvst.obs.event.streamstatus': {e:'StreamStatus', a:['streaming', 'recording', 'replay-buffer-active', 'kbits-per-sec', 'strain',
														'total-stream-time', 'num-total-frames', 'num-dropped-frames', 'fps', 'render-total-frames',
														'render-missed-frames', 'output-total-frames', 'output-skipped-frames', 'average-frame-time',
														'cpu-usage', 'memory-usage', 'free-disk-space']}
} as const;

const OBSActions = {
	'app.ttvst.obs.request.setcurrentscene': {r:'SetCurrentScene',p:['scene-name'],x:''},
	'app.ttvst.obs.request.getcurrentscene': {r:'GetCurrentScene',p:[],x:''},
	'app.ttvst.obs.request.getsceneitemproperties': {r:'GetSceneItemProperties',p:['scene-name','item.name'],x:''},
	'app.ttvst.obs.request.setsourceproperties': {r:'SetSceneItemProperties',p:['_'],x:''},
	'app.ttvst.obs.request.setsourceposition': {r:'SetSceneItemProperties',p:['scene-name', 'item.name', 'position.x', 'position.y', 'position.alignment', '_animation.duration', '_animation.easein', '_animation.easeout'],x:''},
	'app.ttvst.obs.request.setsourcerotation': {r:'SetSceneItemProperties',p:['scene-name', 'item.name', 'rotation', '_animation.duration', '_animation.easein', '_animation.easeout'],x:''},
	'app.ttvst.obs.request.setsourcescale': {r:'SetSceneItemProperties',p:['scene-name', 'item.name', 'scale.x', 'scale.y', '_animation.duration', '_animation.easein', '_animation.easeout'],x:''},
	'app.ttvst.obs.request.setsourcecrop': {r:'SetSceneItemProperties',p:['scene-name', 'item.name', 'crop.top', 'crop.right', 'crop.bottom', 'crop.left', '_animation.duration', '_animation.easein', '_animation.easeout'],x:''},
	'app.ttvst.obs.request.setsourcevisible': {r:'SetSceneItemProperties',p:['scene-name', 'item.name', 'visible'],x:''},
	'app.ttvst.obs.request.setsourcelocked': {r:'SetSceneItemProperties',p:['scene-name', 'item.name', 'locked'],x:''},
	'app.ttvst.obs.request.setsourcebounds': {r:'SetSceneItemProperties',p:['scene-name', 'item.name', 'bounds.type', 'bounds.alignment', 'bounds.x', 'bounds.y'],x:''},

	'app.ttvst.obs.request.getsourcefiltervisibility': {r:'GetSourceFilterInfo',p:['sourceName', 'filterName'],x:'enabled'},
	'app.ttvst.obs.request.getsourcefiltersettings': {r:'GetSourceFilterInfo',p:['sourceName', 'filterName'],x:'settings'},
	'app.ttvst.obs.request.setsourcefiltervisibility': {r:'SetSourceFilterVisibility',p:['sourceName', 'filterName', 'filterEnabled'],x:''},
	'app.ttvst.obs.request.setsourcefiltersettings': {r:'SetSourceFilterSettings',p:['sourceName', 'filterName', 'filterSettings', '_animation.duration', '_animation.easein', '_animation.easeout'],x:''}
} as const;

class OBSRemoteMain {

	connection: OBSWebSocket;
	manualDisconnect: boolean = false;
	currentlyConnecting: boolean = false;

	constructor() {
		ipcMain.on('app.ttvst.obs.connect', this.onConnect.bind(this));
		ipcMain.on('app.ttvst.obs.disconnect', this.onDisconnect.bind(this));
		ipcMain.on('app.ttvst.obs.settingsupdate', this.onSettingsUpdate.bind(this));

		TTVST.startpage.broadcastStatus({ key: 'app.ttvst.obs', icon: 'SmartGlassRemote', status: 'error', title: 'OBS Remote', info: 'Preparing...', buttons: [] });
		this.connection = new OBSWebSocket();

		this.prepareTriggers();
		this.prepareActions();

		const self = this;
		// Added this event to the type definition by myself for now
		this.connection.on('error', (err) => {
			logger.error(err);
			self.connection.disconnect();
			TTVST.startpage.broadcastStatus({ key: 'app.ttvst.obs', status: 'error', info: 'Connection closed', buttons: disconnectedButtons });
			if(!self.manualDisconnect) self.connect();
		});

		this.connect();
	}

	async onConnect() {
		this.manualDisconnect = false;
		this.connect();
	}

	async onDisconnect() {
		this.manualDisconnect = true;
		this.connection.disconnect();
		TTVST.startpage.broadcastStatus({ key: 'app.ttvst.obs', status: 'error', info: 'Connection closed', buttons: disconnectedButtons });
	}

	async onSettingsUpdate() {
		this.connect();
	}

	async connect() {
		if(this.currentlyConnecting || this.manualDisconnect) return;
		this.currentlyConnecting = true;

		let host: string = await TTVST.Settings.getString('app.ttvst.obs.host', 'localhost');
		let port: number = parseInt(await TTVST.Settings.getString('app.ttvst.obs.port', '4444'));
		if(isNaN(port)) port = 4444;
		let pwd: string = await TTVST.Settings.getString('app.ttvst.obs.password', '');

		let options: { address: string, password?: string } = { address: host + ':' + port };
		if(pwd.length > 0) {
			Object.assign(options, { password: pwd });
		}

		
		TTVST.startpage.broadcastStatus({ key: 'app.ttvst.obs', status: 'warn', info: 'Trying to connect...', buttons: connectedButtons });
		try {
			await this.connection.connect(options);
			TTVST.startpage.broadcastStatus({ key: 'app.ttvst.obs', status: 'good', info: 'Connected to OBS', buttons: connectedButtons });
			this.currentlyConnecting = false;
		} catch(reason) {
			if(reason.error.match(/Authentication Failed/i)) {
				TTVST.startpage.broadcastStatus({ key: 'app.ttvst.obs', status: 'error', info: 'Authentication failed', buttons: disconnectedButtons });
				this.currentlyConnecting = false;
			} else {
				TTVST.startpage.broadcastStatus({ key: 'app.ttvst.obs', status: 'warn', info: 'Trying to connect', buttons: connectedButtons });
				if(!this.manualDisconnect) {
					const self = this;
					setTimeout(() => {
						this.currentlyConnecting = false;
						self.connect();
					}, 5000);
				} else {
					TTVST.startpage.broadcastStatus({ key: 'app.ttvst.obs', status: 'error', info: 'Connection closed', buttons: disconnectedButtons });
					this.currentlyConnecting = false;
				}
			}
		}
	}

	private setupTrigger<K extends keyof typeof OBSTriggers>(eventName: typeof OBSTriggers[K]['e'], channel: K, args: typeof OBSTriggers[K]['a']) {
		this.connection.on(eventName, (data: { [key: string]: any }|void) => {
			let prep: Array<string|number|boolean> = [];
			if(typeof(data) === 'object') {
				for(let a of args) {
					if(typeof(data[a]) !== 'undefined') {
						prep.push(data[a]);
					}
				}
			}
			BroadcastMain.instance.emit(channel, ...prep);
		});


		const self = this;
		this.connection.on('Exiting', () => {
			self.connection.disconnect();
			self.connect();
		});
	}

	private prepareTriggers() {
		for(let key of Object.keys(OBSTriggers) as Array<keyof typeof OBSTriggers>) {
			this.setupTrigger(OBSTriggers[key].e, key, OBSTriggers[key].a);
		}
	}


	private cleanupForResponseObject(response: {[key: string]: string|number|boolean}, key: string, tocleanup: any) {
		if(['string', 'number', 'boolean'].indexOf(typeof(tocleanup)) >= 0) {
			response[key] = tocleanup;
		} else if(typeof(tocleanup) === 'object') {
			if(!Array.isArray(tocleanup)) {
				for(let k of Object.keys(tocleanup)) {
					this.cleanupForResponseObject(response, (key.length > 0 ? key + '_' : '') + k, tocleanup[k]);
				}
			}
		}
	}

	private cleanupParamNumbers(param: any) {
		if(typeof(param) === 'object') {
			if(Array.isArray(param)) {
				let i = 0;
				for(let p of param) {
					param[i] = this.cleanupParamNumbers(p);
					i++;
				}
			} else {
				for(let k of Object.keys(param)) {
					param[k] = this.cleanupParamNumbers(param[k]);
				}
			}
		} else if(typeof(param) === 'string') {
			if(param.match(/^-?[0-9,]+(\.[0-9]+)?/)) {
				param = parseFloat(param);
			}
		}
		return param;
	}

	private setupActions<K extends keyof typeof OBSActions>(requestName: typeof OBSActions[K]['r'], channel: K, param: typeof OBSActions[K]['p']) {
		const self = this;
		BroadcastMain.instance.on(channel, (executeId: string, ...params) => {
			let prep: { [key: string]: any } = {};
			let i = 0;

			let animationDuration = 0;
			let animationEaseIn = false;
			let animationEaseOut = false;

			params = self.cleanupParamNumbers(params);
			
			let parameters: string[] = [];
			parameters = param.slice(0);
			if(param.length == 1 && param[0] === '_') {
				parameters = Object.keys(params[0]);
				let paramsTrue = [];
				for(let p of parameters) {
					paramsTrue.push(params[0][p]);
				}

				parameters.push('_animation.duration');parameters.push('_animation.easein');parameters.push('_animation.easeout');
				paramsTrue.push(params[1]);paramsTrue.push(params[2]);paramsTrue.push(params[3]);

				params = paramsTrue;
			}
			for(let p of parameters) {
				if(params.length > i) {
					if(p.startsWith('_')) {
						if(p === '_animation.duration') {
							animationDuration = params[i];
						} else if(p === '_animation.easein') {
							animationEaseIn = params[i];
						} else if(p === '_animation.easeout') {
							animationEaseOut = params[i];
						}
					} else {
						if(p.indexOf('.') > 0) {
							let [obj, key] = p.split('.', 2);
							if(typeof(prep[obj]) !== 'object') {
								prep[obj] = {};
							}
							prep[obj][key] = params[i];
						} else {
							prep[p] = params[i];
						}
					}
					i++;
				} else {
					break;
				}
			}

			if(animationDuration <= 0) {
				self.connection.send(requestName, prep as any).then((values: any) => {
					let action = BroadcastMain.getAction({ channel });
					let returnBoolean = false;
					if(action.length > 0) {
						if(typeof(action[0].result) !== 'undefined' && action[0].result.type == 'boolean') {
							returnBoolean = true;
						}
					}
					if(!returnBoolean && typeof(values) !== 'undefined') {
						let response: {[key: string]: string|number|boolean} = {};
						if(OBSActions[channel].x.length > 0) {
							values = values[OBSActions[channel].x];
						}
						if(typeof(values) === 'object') {
							self.cleanupForResponseObject(response, '', values);
							BroadcastMain.instance.executeRespond(executeId, response);
						} else {
							BroadcastMain.instance.executeRespond(executeId, values);
						}
					} else {
						BroadcastMain.instance.executeRespond(executeId, true);
					}
				}).catch((reason) => {
					logger.error(reason);
					BroadcastMain.instance.executeRespond(executeId, false);
				});
			} else {
				BroadcastMain.instance.executeRespond(executeId, true);
				if(channel === 'app.ttvst.obs.request.setsourcefiltersettings') {
					self.animateFilter(prep, animationDuration, animationEaseIn, animationEaseOut);
				} else {
					self.animateSource(prep, animationDuration, animationEaseIn, animationEaseOut);
				}
			}
		});
	}

	private static easeLinear(time: number, startval: number, change: number, duration: number) {
		return change * time / duration + startval;
	}
	private static easeInQuad(time: number, startval: number, change: number, duration: number) {
		time /= duration;
		return change * time * time + startval;
	}
	private static easeOutQuad(time: number, startval: number, change: number, duration: number) {
		time /= duration;
		return -change * time * (time - 2) + startval;
	}
	private static easeInOutQuad(time: number, startval: number, change: number, duration: number) {
		time /= duration / 2;
		if(time < 1) return change / 2 * time * time + startval;
		time--;
		return -change/2 * (time * (time - 2) - 1) + startval;
	}

	private async animateSource(params: { [key: string]: any }, animationDuration: number, animationEaseIn: boolean, animationEaseOut: boolean) {
		try {
			let startValues = await this.connection.send('GetSceneItemProperties', { 'scene-name': params['scene-name'], 'item': { name: params.item.name } });
			let currentValues: { [key: string]: any } = JSON.parse(JSON.stringify(params));
			let start = new Date().getTime();
			let end = start + animationDuration;
			let minFrameTime = 16; // ~60 fps

			let easeFunc : 'easeLinear'|'easeInQuad'|'easeOutQuad'|'easeInOutQuad' = 'easeLinear';
			if(animationEaseIn && !animationEaseOut) {
				easeFunc = 'easeInQuad';
			} else if(!animationEaseIn && animationEaseOut) {
				easeFunc = 'easeOutQuad';
			} else if(animationEaseIn && animationEaseOut) {
				easeFunc = 'easeInOutQuad';
			}

			logger.debug('[OBS] Starting animation now');

			while(new Date().getTime() < end) {
				let frameStart = new Date().getTime();
				if(typeof(params.position) !== 'undefined') {
					if(typeof(params.position.x) !== 'undefined') {
						currentValues.position.x = OBSRemoteMain[easeFunc](frameStart-start, startValues.position.x, params.position.x - startValues.position.x, animationDuration);
					}
					if(typeof(params.position.y) !== 'undefined') {
						currentValues.position.y = OBSRemoteMain[easeFunc](frameStart-start, startValues.position.y, params.position.y - startValues.position.y, animationDuration);
					}
				}
				if(typeof(params.scale) !== 'undefined') {
					if(typeof(params.scale.x) !== 'undefined') {
						currentValues.scale.x = OBSRemoteMain[easeFunc](frameStart-start, startValues.scale.x, params.scale.x - startValues.scale.x, animationDuration);
					}
					if(typeof(params.scale.y) !== 'undefined') {
						currentValues.scale.y = OBSRemoteMain[easeFunc](frameStart-start, startValues.scale.y, params.scale.y - startValues.scale.y, animationDuration);
					}
				}
				if(typeof(params.crop) !== 'undefined') {
					if(typeof(params.crop.top) !== 'undefined') {
						currentValues.crop.top = OBSRemoteMain[easeFunc](frameStart-start, startValues.crop.top, params.crop.top - startValues.crop.top, animationDuration);
					}
					if(typeof(params.crop.left) !== 'undefined') {
						currentValues.crop.left = OBSRemoteMain[easeFunc](frameStart-start, startValues.crop.left, params.crop.left - startValues.crop.left, animationDuration);
					}
					if(typeof(params.crop.right) !== 'undefined') {
						currentValues.crop.right = OBSRemoteMain[easeFunc](frameStart-start, startValues.crop.right, params.crop.right - startValues.crop.right, animationDuration);
					}
					if(typeof(params.crop.bottom) !== 'undefined') {
						currentValues.crop.bottom = OBSRemoteMain[easeFunc](frameStart-start, startValues.crop.bottom, params.crop.bottom - startValues.crop.bottom, animationDuration);
					}
				}
				if(typeof(params.rotation) !== 'undefined') {
					currentValues.rotation = OBSRemoteMain[easeFunc](frameStart-start, startValues.rotation, params.rotation - startValues.rotation, animationDuration);
				}

				try {
					await this.connection.send('SetSceneItemProperties', currentValues as any);
				} catch(er) {
					logger.error(er);
				}
				let frameEnd = new Date().getTime();

				let wait = frameEnd - frameStart;
				while(wait > minFrameTime) wait -= minFrameTime;
				wait = minFrameTime - wait;

				await new Promise((r) => { setTimeout(r, wait) });
			}

			logger.debug('[OBS] Animation finished');
			try {
				await this.connection.send('SetSceneItemProperties', params as any);
			} catch(er) {
				logger.error(er);
			}
		} catch(e) {
			logger.error(e);
		}
	}

	private async animateFilter(params: { [key: string]: any }, animationDuration: number, animationEaseIn: boolean, animationEaseOut: boolean) {
		try {
			let startValues = (await this.connection.send('GetSourceFilterInfo', { 'sourceName': params['sourceName'], 'filterName': params['filterName'] })) as any;
			let currentValues: { [key: string]: any } = JSON.parse(JSON.stringify(params));
			let start = new Date().getTime();
			let end = start + animationDuration;
			let minFrameTime = 16; // ~60 fps

			let easeFunc : 'easeLinear'|'easeInQuad'|'easeOutQuad'|'easeInOutQuad' = 'easeLinear';
			if(animationEaseIn && !animationEaseOut) {
				easeFunc = 'easeInQuad';
			} else if(!animationEaseIn && animationEaseOut) {
				easeFunc = 'easeOutQuad';
			} else if(animationEaseIn && animationEaseOut) {
				easeFunc = 'easeInOutQuad';
			}

			logger.debug('[OBS] Starting animation now');

			while(new Date().getTime() < end) {
				let frameStart = new Date().getTime();
				if(typeof(params.filterSettings.brightness) !== 'undefined') {
					currentValues.filterSettings.brightness = OBSRemoteMain[easeFunc](frameStart-start, startValues.settings.brightness, params.filterSettings.brightness - startValues.settings.brightness, animationDuration);
				}
				if(typeof(params.filterSettings.contrast) !== 'undefined') {
					currentValues.filterSettings.contrast = OBSRemoteMain[easeFunc](frameStart-start, startValues.settings.contrast, params.filterSettings.contrast - startValues.settings.contrast, animationDuration);
				}
				if(typeof(params.filterSettings.gamma) !== 'undefined') {
					currentValues.filterSettings.gamma = OBSRemoteMain[easeFunc](frameStart-start, startValues.settings.gamma, params.filterSettings.gamma - startValues.settings.gamma, animationDuration);
				}
				if(typeof(params.filterSettings.hue_shift) !== 'undefined') {
					currentValues.filterSettings.hue_shift = OBSRemoteMain[easeFunc](frameStart-start, startValues.settings.hue_shift, params.filterSettings.hue_shift - startValues.settings.hue_shift, animationDuration);
				}
				if(typeof(params.filterSettings.opacity) !== 'undefined') {
					currentValues.filterSettings.opacity = OBSRemoteMain[easeFunc](frameStart-start, startValues.settings.opacity, params.filterSettings.opacity - startValues.settings.opacity, animationDuration);
				}
				if(typeof(params.filterSettings.saturation) !== 'undefined') {
					currentValues.filterSettings.saturation = OBSRemoteMain[easeFunc](frameStart-start, startValues.settings.saturation, params.filterSettings.saturation - startValues.settings.saturation, animationDuration);
				}

				try {
					await this.connection.send('SetSourceFilterSettings', currentValues as any);
				} catch(er) {
					logger.error(er);
				}
				let frameEnd = new Date().getTime();

				let wait = frameEnd - frameStart;
				while(wait > minFrameTime) wait -= minFrameTime;
				wait = minFrameTime - wait;

				await new Promise((r) => { setTimeout(r, wait) });
			}

			logger.debug('[OBS] Animation finished');
			try {
				await this.connection.send('SetSourceFilterSettings', params as any);
			} catch(er) {
				logger.error(er);
			}
		} catch(e) {
			logger.error(e);
		}
	}

	private prepareActions() {
		for(let key of Object.keys(OBSActions) as Array<keyof typeof OBSActions>) {
			this.setupActions(OBSActions[key].r, key, OBSActions[key].p);
		}
	}

}
export = OBSRemoteMain;