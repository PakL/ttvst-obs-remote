import { ipcRenderer } from 'electron';

import TTVSTRenderer from '../../dist/dev.pakl.ttvst/renderer/TTVST';
import SettingsPage from '../../dist/dev.pakl.ttvst/renderer/Pages/SettingsPage';

declare var TTVST: TTVSTRenderer;

class OBSRemoteSettings {

	constructor() {
		this.onAnyChange = this.onAnyChange.bind(this);

		let settingsPage = TTVST.ui.getPage('Settings') as SettingsPage;
		if(settingsPage !== null) {
			settingsPage.addSettingsSet({
				label: 'OBS Remote',
				key: 'app.ttvst.obs',
				settings: [
					{
						type: 'text',
						setting: 'app.ttvst.obs.host',
						label: 'OBS Host',
						description: 'IP address or hostname of the computer that OBS is executed on',
						default: 'localhost',
						oninputchange: this.onAnyChange
					},
					{
						type: 'number',
						setting: 'app.ttvst.obs.port',
						label: 'Websocket port',
						description: 'Port of the OBS websocket server',
						default: 4444,
						min: 1025, max: 65535,
						oninputchange: this.onAnyChange
					},
					{
						type: 'password',
						setting: 'app.ttvst.obs.password',
						label: 'Password',
						description: 'Password to authenticate the at the websocket server',
						default: '',
						oninputchange: this.onAnyChange
					}
				]
			});
		}
	}

	onAnyChange() {
		ipcRenderer.send('app.ttvst.obs.settingsupdate');
	}

}

export = OBSRemoteSettings;