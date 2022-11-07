import OBSWebSocket from 'obs-websocket-js';
import { ipcMain } from 'electron';
import { networkInterfaces } from 'os';
import { OBSEventTypes } from 'obs-websocket-js';

import TTVSTMain from '../../dist/dev.pakl.ttvst/main/TTVSTMain';
import winston, { stream } from 'winston';
import OBSRemoteAnimations from './OBSRemoteAnimations';

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
	'app.ttvst.obs.request.setcurrentscene': {r:'SetCurrentProgramScene',p:['sceneName'],x:''},
	'app.ttvst.obs.request.getcurrentscene': {r:'GetCurrentProgramScene',p:[],x:''},
	'app.ttvst.obs.request.getsceneitemproperties': {r:'GetSceneItemProperties',p:['scene-name','item.name'],x:''},
	'app.ttvst.obs.request.setsourceproperties': {r:'SetSceneItemProperties',p:['_'],x:''},

	'app.ttvst.obs.request.getsourcesettings': {r:'GetSourceSettings',p:['sourceName'],x:'sourceSettings'},
	'app.ttvst.obs.request.setsourcesettings': {r:'SetSourceSettings',p:['sourceName', 'sourceSettings'],x:''},

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
	'app.ttvst.obs.request.setsourcefiltersettings': {r:'SetSourceFilterSettings',p:['sourceName', 'filterName', 'filterSettings', '_animation.duration', '_animation.easein', '_animation.easeout'],x:''},
	'app.ttvst.obs.request.refreshbrowser': {r:'RefreshBrowserSource',p:['sourceName'],x:''}
} as const;

interface ISourcePropertiesIn {
	[key: string]: any,

	"scene-name"?: string,
	item?: string,
	item_id?: number,
	item_name?: string,
	position_x?: number,
	position_y?: number,
	position_alignment?: number,
	rotation?: number,
	scale_x?: number,
	scale_y?: number,
	scale_filter?: number,
	crop_top?: number,
	crop_bottom?: number,
	crop_left?: number,
	crop_right?: number,
	visible?: boolean,
	locked?: boolean,
	bounds_alignment?: number,
	bounds_x?: number,
	bounds_y?: number

	positionX?: number,
	positionY?: number,
	alignment?: number,
	scaleX?: number,
	scaleY?: number,
	cropTop?: number,
	cropBottom?: number,
	cropLeft?: number,
	cropRight?: number,
	boundsType?: string,
	boundsAlignment?: number,
	boundsWidth?: number,
	boundsHeight?: number
}

interface IFilterSettingsIn {
	[key: string]: any,

	brightness?: number,
	contrast?: number,
	gamma?: number,
	hue_shift?: number,
	opacity?: number,
	saturation?: number
}

class OBSRemoteMain {

	connection: OBSWebSocket;
	manualDisconnect: boolean = false;
	currentlyConnecting: boolean = false;
	animations: OBSRemoteAnimations;

	constructor() {
		ipcMain.on('app.ttvst.obs.connect', this.onConnect.bind(this));
		ipcMain.on('app.ttvst.obs.disconnect', this.onDisconnect.bind(this));
		ipcMain.on('app.ttvst.obs.settingsupdate', this.onSettingsUpdate.bind(this));

		TTVST.startpage.broadcastStatus({ key: 'app.ttvst.obs', icon: 'SmartGlassRemote', status: 'error', title: 'OBS Remote', info: 'Preparing...', buttons: [] });
		this.connection = new OBSWebSocket();
		this.animations = new OBSRemoteAnimations(this.connection);

		this.prepareTriggers();
		this.prepareActions();
		this.keepingAlive();

		const self = this;
		this.connection.on('ConnectionError', (err) => {
			if(!err.message.match(/ECONNREFUSED/)) logger.error(err);
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

		let options: { address: string, password?: string } = { address: 'ws://' + host + ':' + port };
		if(pwd.length > 0) {
			Object.assign(options, { password: pwd });
		}

		
		TTVST.startpage.broadcastStatus({ key: 'app.ttvst.obs', status: 'warn', info: 'Trying to connect...', buttons: connectedButtons });
		try {
			await this.connection.connect(options.address, options.password);
			TTVST.startpage.broadcastStatus({ key: 'app.ttvst.obs', status: 'good', info: 'Connected to OBS', buttons: connectedButtons });
			this.currentlyConnecting = false;

			if(TTVST.addons.addonInstalled('app.ttvst.overlay')) {
				/** Refresh browser overlays from overlay host */

				let ipaddresses = ['localhost'];
				let ipinterfaces = networkInterfaces();
				let overlayport = parseInt(await TTVST.Settings.getString('overlayhost.global.port', '8090'));

				for(let intf in ipinterfaces) {
					for(let i = 0; i < ipinterfaces[intf].length; i++) {
						ipaddresses.push(ipinterfaces[intf][i].family == 'IPv6' ? '['+ipinterfaces[intf][i].address+']' : ipinterfaces[intf][i].address);
					}
				}

				try {
					let resp = await this.connection.call('GetInputList', { inputKind: 'browser_source' });
					for(let i = 0; i < resp.inputs.length; i++) {
						let browserSettings = await this.connection.call('GetInputSettings', { inputName: resp.inputs[i].inputName as string });
						let url = (browserSettings.inputSettings as {url:string}).url;
						for(let j = 0; j < ipaddresses.length; j++) {
							if(url.match(new RegExp('^https?:\\/\\/' + ipaddresses[j] + ':' + overlayport, 'i'))) {
								await this.connection.call('PressInputPropertiesButton', { inputName: resp.inputs[i].inputName as string, propertyName: 'refreshnocache' });
								break;
							}
						}
					}
				} catch(e) {}
			}
		} catch(reason) {
			if(typeof(reason.message) !== 'undefined' && reason.message.match(/Authentication Failed/i)) {
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

	async keepingAlive() {
		try {
			let stats = await this.connection.call('GetStats');
			let streamStatus = await this.connection.call('GetStreamStatus');
			let recordStatus = await this.connection.call('GetRecordStatus');
			let bufferStatus = await this.connection.call('GetReplayBufferStatus');

			BroadcastMain.instance.emit('app.ttvst.obs.event.streamstatus',
				streamStatus.outputActive, recordStatus.outputActive, bufferStatus.outputActive, -1, (100 / streamStatus.outputTotalFrames * streamStatus.outputSkippedFrames),
				(streamStatus.outputDuration / 1000), streamStatus.outputTotalFrames, streamStatus.outputSkippedFrames, stats.activeFps, stats.renderTotalFrames,
				stats.renderSkippedFrames, stats.renderTotalFrames, stats.outputSkippedFrames, stats.averageFrameRenderTime,
				stats.cpuUsage, stats.memoryUsage, stats.availableDiskSpace
			);
		} catch(e) {}
		setTimeout((() => { this.keepingAlive(); }).bind(this), 2000);
	}

	private prepareTriggers() {
		const self = this;

		this.connection.on('CurrentProgramSceneChanged', (data) => {
			BroadcastMain.instance.emit('app.ttvst.obs.event.switchscenes', data.sceneName);
		});
		this.connection.on('StreamStateChanged', (data) => {
			BroadcastMain.instance.emit('app.ttvst.obs.event.' + (data.outputActive ? 'streamstarted' : 'streamstopped'));
		});

		this.connection.on('ConnectionClosed', () => {
			self.connect();
		});
		this.connection.on('ExitStarted', () => {
			self.connection.disconnect();
			self.connect();
		});
	}

	private async defaultToCurrentScene(sceneName: string): Promise<string> {
		if(typeof(sceneName) !== 'string') sceneName = '';
		if(sceneName.length <= 0) sceneName = (await this.connection.call('GetCurrentProgramScene')).currentProgramSceneName;
		return sceneName;
	}

	private async sourceNametoId(sceneName: string, sourceName: string): Promise<number> {
		let sceneItems = await this.connection.call('GetSceneItemList', { sceneName });

		for(let i = 0; i < sceneItems.sceneItems.length; i++) {
			if(sceneItems.sceneItems[i].sourceName == sourceName) {
				return sceneItems.sceneItems[i].sceneItemId as number;
			}
		}
		return -1;
	}

	private async setSourceTransform(executeId: string, sourceProperties: ISourcePropertiesIn, animationDuration: number, animationEaseIn: boolean, animationEaseOut: boolean) {
		let success = false;

		try {
			let sceneName = await this.defaultToCurrentScene(sourceProperties['scene-name']);
			let sceneItemId = -1;
			if(typeof(sourceProperties.item_id) === 'number') {
				sceneItemId = sourceProperties.item_id;
			} else if(typeof(sourceProperties.item) === 'string') {
				sceneItemId = await this.sourceNametoId(sceneName, sourceProperties.item);
			} else if(typeof(sourceProperties.item_name) === 'string') {
				sceneItemId = await this.sourceNametoId(sceneName, sourceProperties.item);
			} else {
				BroadcastMain.instance.executeRespond(executeId, false);
				return;
			}

			if(sceneItemId < 0) {
				BroadcastMain.instance.executeRespond(executeId, false);
				return;
			}

			delete sourceProperties['scene-name'];
			delete sourceProperties.item;
			delete sourceProperties.item_id;
			delete sourceProperties.item_name;

			let translate = {
				position_x: 'positionX',
				position_y: 'positionY',
				position_alignment: 'alignment',
				scale_x: 'scaleX',
				scale_y: 'scaleY',
				crop_top: 'cropTop',
				crop_bottom: 'cropBottom',
				crop_left: 'cropLeft',
				crop_right: 'cropRight',
				bounds_type: 'boundsType',
				bounds_alignment: 'boundsAlignment',
				bounds_x: 'boundsWidth',
				bounds_y: 'boundsHeight'
			};

			for(let key in sourceProperties) {
				if(typeof(translate[key as keyof typeof translate]) === 'string') {
					sourceProperties[translate[key as keyof typeof translate]] = sourceProperties[key];
					delete sourceProperties[key];
				}
			}
			for(let key in sourceProperties) {
				sourceProperties[key] = parseFloat(sourceProperties[key]);
			}

			if(typeof(sourceProperties.visible) === 'boolean') {
				await this.connection.call('SetSceneItemEnabled', { sceneName, sceneItemId, sceneItemEnabled: sourceProperties.visible });
				delete sourceProperties.visible;
			}
			if(typeof(sourceProperties.locked) === 'boolean') {
				await this.connection.call('SetSceneItemLocked', { sceneName, sceneItemId, sceneItemLocked: sourceProperties.locked});
				delete sourceProperties.locked;
			}

			if(animationDuration > 0) {
				let now: ISourcePropertiesIn = {};
				let final : { boundsHeight?: number, boundsWidth?: number, cropBottom?: number, cropLeft?: number, cropRight?: number, cropTop?: number, positionX?: number, positionY?: number, scaleX?: number, scaleY?: number, rotation?: number } = {};
				for(let key in sourceProperties) {
					if(['boundsHeight', 'boundsWidth', 'cropBottom', 'cropLeft', 'cropRight', 'cropTop', 'positionX', 'positionY', 'scaleX', 'scaleY', 'rotation'].indexOf(key) >= 0) {
						final[key as keyof typeof final] = sourceProperties[key];
					} else {
						now[key] = sourceProperties[key];
					}
				}
				
				if(Object.keys(now).length > 0) {
					try {
						await this.connection.call('SetSceneItemTransform', { sceneName, sceneItemId, sceneItemTransform: now });
					} catch(e) {};
				}

				if(Object.keys(final).length > 0) {
					let t = await this.connection.call('GetSceneItemTransform', { sceneName, sceneItemId });
					this.animations.addAnimation({
						call: 'SetSceneItemTransform',
						duration: animationDuration,
						easeIn: animationEaseIn,
						easeOut: animationEaseOut,
						sceneName,
						sceneItemId,
						starttime: new Date().getTime(),
						startingValues: t.sceneItemTransform as { boundsHeight: number, boundsWidth: number, cropBottom: number, cropLeft: number, cropRight: number, cropTop: number, positionX: number, positionY: number, scaleX: number, scaleY: number, rotation: number },
						finalValues: final
					});
				}

				success = true;
			} else {
				if(Object.keys(sourceProperties).length > 0) {
					try {
						await this.connection.call('SetSceneItemTransform', { sceneName, sceneItemId, sceneItemTransform: sourceProperties });
					} catch(e) {};
				}
				success = true;
			}
		} catch(e) {
			logger.error(e);
		}

		BroadcastMain.instance.executeRespond(executeId, success);
	}

	private prepareActions() {
		/*for(let key of Object.keys(OBSActions) as Array<keyof typeof OBSActions>) {
			this.setupActions(OBSActions[key].r, key, OBSActions[key].p);
		}
		this.setupSpecialActions();*/
		const self = this;
		BroadcastMain.instance.on('app.ttvst.obs.request.setcurrentscene', async (executeId: string, sceneName: string) => {
			let success = false;
			try {
			 	await self.connection.call('SetCurrentProgramScene', { sceneName });
				success = true;
			} catch(e) {}
			BroadcastMain.instance.executeRespond(executeId, success);
		});
		BroadcastMain.instance.on('app.ttvst.obs.request.getcurrentscene', async (executeId: string) => {
			let currentScene = { currentProgramSceneName: '' };
			try {
				currentScene = await self.connection.call('GetCurrentProgramScene');
			} catch(e) {
				logger.error(e);
			}
			BroadcastMain.instance.executeRespond(executeId, currentScene.currentProgramSceneName);
		});
		BroadcastMain.instance.on('app.ttvst.obs.request.getcurrentsources', async (executeId: string, sceneName: string) => {
			let items = [];
			try {
				sceneName = await self.defaultToCurrentScene(sceneName);
				let sceneItems = await self.connection.call('GetSceneItemList', { sceneName });
				for(let i = 0; i < sceneItems.sceneItems.length; i++) {
					items.push(sceneItems.sceneItems[i].sourceName);
				}
			} catch(e) {
				logger.error(e);
			}
			BroadcastMain.instance.executeRespond(executeId, items);
		});
		BroadcastMain.instance.on('app.ttvst.obs.request.getsceneitemproperties', async (executeId: string, sceneName: string, sourceName: string) => {
			let result = {};
			try {
				if(sourceName.length <= 0) { BroadcastMain.instance.executeRespond(executeId, {}); return; }
				sceneName = await self.defaultToCurrentScene(sceneName);
				let sceneItemId = await self.sourceNametoId(sceneName, sourceName);

				let transform = await self.connection.call('GetSceneItemTransform', { sceneName, sceneItemId });
				let enabled = await self.connection.call('GetSceneItemEnabled', { sceneName, sceneItemId });
				let locked = await self.connection.call('GetSceneItemLocked', { sceneName, sceneItemId });
				let muted = false;
				try {
					let m = await self.connection.call('GetInputMute', { inputName: sourceName });
					muted = m.inputMuted;
				} catch(e) {}

				result = {
					name: sourceName,
					itemId: sceneItemId,
					position_x: transform.sceneItemTransform.positionX,
					position_y: transform.sceneItemTransform.positionY,
					position_alignment: transform.sceneItemTransform.alignment,
					rotation: transform.sceneItemTransform.rotation,
					scale_x: transform.sceneItemTransform.scaleX,
					scale_y: transform.sceneItemTransform.scaleY,
					scale_filter: 'OBS_SCALE_DISABLE',
					crop_top: transform.sceneItemTransform.cropTop,
					crop_right: transform.sceneItemTransform.cropRight,
					crop_bottom: transform.sceneItemTransform.cropBottom,
					crop_left: transform.sceneItemTransform.cropLeft,
					visible: enabled.sceneItemEnabled,
					muted: muted,
					locked: locked.sceneItemLocked,
					bounds_type: transform.sceneItemTransform.boundsType,
					bounds_alignment: transform.sceneItemTransform.boundsAlignment,
					bounds_x: transform.sceneItemTransform.boundsWidth,
					bounds_y: transform.sceneItemTransform.boundsHeight,
					sourceWidth: transform.sceneItemTransform.sourceWidth,
					sourceHeight: transform.sceneItemTransform.sourceHeight,
					width: transform.sceneItemTransform.width,
					height: transform.sceneItemTransform.height
				};
			} catch(e) {
				logger.error(e);
			}
			BroadcastMain.instance.executeRespond(executeId, result);
		});
		BroadcastMain.instance.on('app.ttvst.obs.request.setsourceproperties', this.setSourceTransform);
		BroadcastMain.instance.on('app.ttvst.obs.request.getsourcesettings', async (executeId: string, sourceName: string) => {
			let result = {};
			try {
				let settings = await self.connection.call('GetInputSettings', { inputName: sourceName });
				result = settings.inputSettings;
			} catch(e) {
				logger.error(e);
			}
			BroadcastMain.instance.executeRespond(executeId, result);
		});
		BroadcastMain.instance.on('app.ttvst.obs.request.setsourcesettings', async (executeId: string, sourceName: string, sourceSettings: { [key: string]: any }) => {
			let success = false;
			try {
				await self.connection.call('SetInputSettings', { inputName: sourceName, inputSettings: sourceSettings, overlay: true });
				success = true;
			} catch(e) {
				logger.error(e);
			}
			BroadcastMain.instance.executeRespond(executeId, success);
		});
		BroadcastMain.instance.on('app.ttvst.obs.request.setsourceposition', async (executeId: string, sceneName: string, sourceName: string, positionX: number, positionY: number, positionAlignment: number, animationDuration: number, animationEaseIn: boolean, animationEaseOut: boolean) => {
			self.setSourceTransform(executeId, {
				'scene-name': sceneName,
				item: sourceName,
				positionX,
				positionY,
				position_alignment: positionAlignment
			}, animationDuration, animationEaseIn, animationEaseOut);
		});
		BroadcastMain.instance.on('app.ttvst.obs.request.setsourcerotation', async (executeId: string, sceneName: string, sourceName: string, rotation: number, animationDuration: number, animationEaseIn: boolean, animationEaseOut: boolean) => {
			self.setSourceTransform(executeId, {
				'scene-name': sceneName,
				item: sourceName,
				rotation,
			}, animationDuration, animationEaseIn, animationEaseOut);
		});
		BroadcastMain.instance.on('app.ttvst.obs.request.setsourcescale', async (executeId: string, sceneName: string, sourceName: string, scaleX: number, scaleY: number, animationDuration: number, animationEaseIn: boolean, animationEaseOut: boolean) => {
			self.setSourceTransform(executeId, {
				'scene-name': sceneName,
				item: sourceName,
				scaleX,
				scaleY
			}, animationDuration, animationEaseIn, animationEaseOut);
		});
		BroadcastMain.instance.on('app.ttvst.obs.request.setsourcecrop', async (executeId: string, sceneName: string, sourceName: string, cropTop: number, cropRight: number, cropBottom: number, cropLeft: number, animationDuration: number, animationEaseIn: boolean, animationEaseOut: boolean) => {
			self.setSourceTransform(executeId, {
				'scene-name': sceneName,
				item: sourceName,
				cropTop,
				cropRight,
				cropBottom,
				cropLeft
			}, animationDuration, animationEaseIn, animationEaseOut);
		});
		BroadcastMain.instance.on('app.ttvst.obs.request.setsourcevisible', async (executeId: string, sceneName: string, sourceName: string, visible: boolean, animationDuration: number, animationEaseIn: boolean, animationEaseOut: boolean) => {
			self.setSourceTransform(executeId, {
				'scene-name': sceneName,
				item: sourceName,
				visible,
			}, animationDuration, animationEaseIn, animationEaseOut);
		});
		BroadcastMain.instance.on('app.ttvst.obs.request.setsourcelocked', async (executeId: string, sceneName: string, sourceName: string, locked: boolean, animationDuration: number, animationEaseIn: boolean, animationEaseOut: boolean) => {
			self.setSourceTransform(executeId, {
				'scene-name': sceneName,
				item: sourceName,
				locked,
			}, animationDuration, animationEaseIn, animationEaseOut);
		});
		BroadcastMain.instance.on('app.ttvst.obs.request.setsourcebounds', async (executeId: string, sceneName: string, sourceName: string, boundsType: string, boundsAlignment: number, boundsWidth: number, boundsHeight: number, animationDuration: number, animationEaseIn: boolean, animationEaseOut: boolean) => {
			self.setSourceTransform(executeId, {
				'scene-name': sceneName,
				item: sourceName,
				boundsType,
				boundsAlignment,
				boundsWidth,
				boundsHeight
			}, animationDuration, animationEaseIn, animationEaseOut);
		});

		BroadcastMain.instance.on('app.ttvst.obs.request.getsourcefiltervisibility', async (executeId: string, sourceName: string, filterName: string) => {
			let result = false;
			try {
				let filter = await self.connection.call('GetSourceFilter', { sourceName, filterName });
				result = filter.filterEnabled;
			} catch(e) {
				logger.error(e);
			}
			BroadcastMain.instance.executeRespond(executeId, result);
		});
		BroadcastMain.instance.on('app.ttvst.obs.request.getsourcefiltersettings', async (executeId: string, sourceName: string, filterName: string) => {
			let result = {};
			try {
				let filter = await self.connection.call('GetSourceFilter', { sourceName, filterName });
				result = filter.filterSettings;
			} catch(e) {
				logger.error(e);
			}
			BroadcastMain.instance.executeRespond(executeId, result);
		});
		BroadcastMain.instance.on('app.ttvst.obs.request.setsourcefiltervisibility', async (executeId: string, sourceName: string, filterName: string, filterEnabled: boolean) => {
			let success = false;
			try {
				await self.connection.call('SetSourceFilterEnabled', { sourceName, filterName, filterEnabled });
				success = true;
			} catch(e) {
				logger.error(e);
			}
			BroadcastMain.instance.executeRespond(executeId, success);
		});
		BroadcastMain.instance.on('app.ttvst.obs.request.setsourcefiltersettings', async (executeId: string, sourceName: string, filterName: string, filterSettings: IFilterSettingsIn, animationDuration: number, animationEaseIn: boolean, animationEaseOut: boolean) => {
			let success = false;

			try {
				for(let key in filterSettings) {
					if(filterSettings[key].toString().match(/^-?[0-9]+(\.[0-9]+)?$/))
						filterSettings[key] = parseFloat(filterSettings[key].toString());
				}

				if(animationDuration > 0) {

					let now: IFilterSettingsIn = {};
					let final : { brightness?: number, contrast?: number, gamma?: number, hue_shift?: number, opacity?: number, saturation?: number } = {};
					for(let key in filterSettings) {
						if(['brightness', 'contrast', 'gamma', 'hue_shift', 'opacity', 'saturation'].indexOf(key) >= 0) {
							final[key as keyof typeof final] = filterSettings[key];
						} else {
							now[key] = filterSettings[key];
						}
					}
					
					if(Object.keys(now).length > 0) {
						try {
							await this.connection.call('SetSourceFilterSettings', { sourceName, filterName, filterSettings: now });
						} catch(e) {};
					}

					
					if(Object.keys(final).length > 0) {
						let t = await this.connection.call('GetSourceFilter', { sourceName, filterName });
						let startVals = {
							brightness: (t.filterSettings.brightness ?? 0) as number,
							contrast: (t.filterSettings.contrast ?? 0) as number,
							gamma: (t.filterSettings.gamma ?? 0) as number,
							hue_shift: (t.filterSettings.hue_shift ?? 0) as number,
							opacity: (t.filterSettings.opacity ?? 1) as number,
							saturation: (t.filterSettings.saturation ?? 0) as number
						}
						this.animations.addAnimation({
							call: 'SetSourceFilterSettings',
							duration: animationDuration,
							easeIn: animationEaseIn,
							easeOut: animationEaseOut,
							sourceName,
							filterName,
							starttime: new Date().getTime(),
							startingValues: startVals,
							finalValues: final
						});
					}

					success = true;
				} else {
					if(Object.keys(filterSettings).length > 0) {
						try {
							await this.connection.call('SetSourceFilterSettings', { sourceName, filterName, filterSettings });
						} catch(e) {};
					}
					success = true;
				}
			} catch(e) {
				logger.error(e);
			}

			BroadcastMain.instance.executeRespond(executeId, success);
		});

		BroadcastMain.instance.on('app.ttvst.obs.request.refreshbrowser', async (executeId: string, inputName: string) => {
			let success = false;
			try {
				await self.connection.call('PressInputPropertiesButton', { inputName, propertyName: 'refreshnocache' });
				success = true;
			} catch(e) {
				logger.error(e);
			}
			BroadcastMain.instance.executeRespond(executeId, success);
		})

	}

}
export = OBSRemoteMain;