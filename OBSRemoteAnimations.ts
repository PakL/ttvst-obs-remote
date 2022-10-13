import OBSWebSocket from "obs-websocket-js"

interface IAnimation {
	starttime: number,
	duration: number,
	easeIn: boolean,
	easeOut: boolean,
	call: string,
	startingValues: { [key: string]: number },
	finalValues: { [key: string]: number }
}
interface IAnimationTransform extends IAnimation {
	call: 'SetSceneItemTransform',
	sceneName: string,
	sceneItemId: number,
	startingValues: {
		boundsHeight: number,
		boundsWidth: number,
		cropBottom: number,
		cropLeft: number,
		cropRight: number,
		cropTop: number,
		positionX: number,
		positionY: number,
		scaleX: number,
		scaleY: number,
		rotation: number
	},
	finalValues: {
		boundsHeight?: number,
		boundsWidth?: number,
		cropBottom?: number,
		cropLeft?: number,
		cropRight?: number,
		cropTop?: number,
		positionX?: number,
		positionY?: number,
		scaleX?: number,
		scaleY?: number,
		rotation?: number
	}
}
interface IAnimationFilter extends IAnimation {
	call: 'SetSourceFilterSettings',
	sourceName: string,
	filterName: string,
	startingValues: {
		brightness: number,
		contrast: number,
		gamma: number,
		hue_shift: number,
		opacity: number,
		saturation: number
	},
	finalValues: {
		brightness?: number,
		contrast?: number,
		gamma?: number,
		hue_shift?: number,
		opacity?: number,
		saturation?: number
	}
	
}

class OBSRemoteAnimations {

	static framerate = 60;

	runningInterval: NodeJS.Timer = null;
	animations: Array<IAnimationTransform|IAnimationFilter> = [];
	obs: OBSWebSocket = null;

	constructor(obs: OBSWebSocket) {
		this.obs = obs;
	}
	
	startInterval() {
		if(this.runningInterval === null) {
			this.runningInterval = setInterval(this.tick.bind(this), Math.floor(1000 / OBSRemoteAnimations.framerate));
		}
	}

	addAnimation(animation: IAnimationTransform|IAnimationFilter) {
		this.animations.push(animation);
		this.startInterval();
	}

	tick() {
		let leftover = [];
		let now = new Date().getTime();
		for(let i = 0; i < this.animations.length; i++) {
			let anim = this.animations[i];
			if(anim.starttime+anim.duration < now) {
				if(anim.call == 'SetSceneItemTransform') {
					this.obs.call(anim.call, { sceneName: anim.sceneName, sceneItemId: anim.sceneItemId, sceneItemTransform: anim.finalValues }).catch((e) => {});
				} else {
					this.obs.call(anim.call, { sourceName: anim.sourceName, filterName: anim.filterName, filterSettings: anim.finalValues }).catch((e) => {});
				}
			} else {
				let easeFunc : 'easeLinear'|'easeInQuad'|'easeOutQuad'|'easeInOutQuad' = 'easeLinear';
				if(anim.easeIn && !anim.easeOut) {
					easeFunc = 'easeInQuad';
				} else if(!anim.easeIn && anim.easeOut) {
					easeFunc = 'easeOutQuad';
				} else if(anim.easeIn && anim.easeOut) {
					easeFunc = 'easeInOutQuad';
				}

				let currentValues: { [key: string]: any } = Object.assign({}, anim.finalValues);

				for(let key in currentValues) {
					currentValues[key] = OBSRemoteAnimations[easeFunc]((now - anim.starttime), (anim as IAnimation).startingValues[key], (anim as IAnimation).finalValues[key] - (anim as IAnimation).startingValues[key], anim.duration);
				}

				if(anim.call == 'SetSceneItemTransform') {
					this.obs.call(anim.call, { sceneName: anim.sceneName, sceneItemId: anim.sceneItemId, sceneItemTransform: currentValues }).catch((e) => {});
				} else {
					this.obs.call(anim.call, { sourceName: anim.sourceName, filterName: anim.filterName, filterSettings: currentValues }).catch((e) => {});
				}

				leftover.push(anim);
			}
		}

		this.animations = leftover;
		if(this.animations.length == 0) {
			clearInterval(this.runningInterval);
			this.runningInterval = null;
		}
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

}
export = OBSRemoteAnimations;