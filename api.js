import {uuid} from './logic.js';
export class ApiError extends Error {
  constructor(code, status = 0) { super(code); this.status = status; }
}
export class PlaytestApi {
  constructor(storage = localStorage, fetcher = (...args) => fetch(...args), basePath = '/v1/playtest', apiOrigin = globalThis.OUAT_CONFIG?.apiOrigin || '') {
    this.storage = storage; this.fetcher = fetcher; this.basePath = basePath; this.apiOrigin = String(apiOrigin).replace(/\/$/, ''); this.token = null;
    this.prefix = 'ouat.web.v1.';
    this.onView = () => {};
    this.onStage = () => {};
  }
  async request(path, body) {
    const url = /^https?:\/\//i.test(path) ? path : `${this.apiOrigin}${path}`;
    const response = await this.fetcher(url, {method: body ? 'POST' : 'GET',
      headers: {'Content-Type':'application/json', ...(this.token ? {Authorization:`Bearer ${this.token}`} : {})},
      body: body ? JSON.stringify(body) : undefined, cache:'no-store', redirect:'error',
      signal: AbortSignal.timeout(['judge','generate','attempt_takeover'].includes(body?.type) ? 260000 : 15000)});
    const data = await response.json();
    if (!response.ok) throw new ApiError(data.error?.code || 'REQUEST_FAILED', response.status);
    return data;
  }
  async prepare() {
    this.token = this.storage.getItem(this.prefix+'guest');
    if (!this.token) {
      this.token = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
        .replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
      this.storage.setItem(this.prefix+'guest', this.token);
    }
    await this.request('/v1/visitors', {guest_token:this.token});
  }
  cached() { return JSON.parse(this.storage.getItem(this.prefix+'view') || 'null'); }
  queue(type, revision, fields = {}) {
    if (this.storage.getItem(this.prefix+'pending')) return null;
    const command = {...fields, command_id:uuid(), type, expected_revision:revision};
    this.storage.setItem(this.prefix+'pending', JSON.stringify(command));
    return command;
  }
  cache(view, snapshot=false) {
    this.storage.setItem(this.prefix+'view', JSON.stringify(view));
    this.onView(view,{snapshot:snapshot||!!this.hydrating});
    return view;
  }
  async flush() {
    const raw = this.storage.getItem(this.prefix+'pending');
    if (!raw) return null;
    const command = JSON.parse(raw);
    this.onStage(command.type);
    try {
      const result = await this.request(`${this.basePath}/commands`, command);
      this.storage.removeItem(this.prefix+'pending');
      if(command.type==='reset'){
        for(let i=this.storage.length-1;i>=0;i--){const key=this.storage.key(i);if(key?.startsWith('ouat.draft.'))this.storage.removeItem(key);}
      }
      return this.cache(result);
    } catch (error) {
      if (error.status >= 400 && error.status < 500 && ![401,408,429].includes(error.status)) {
        this.storage.removeItem(this.prefix+'pending');
      }
      throw error;
    }
  }
  async sync({autoJudge = true} = {}) {
    let view;
    this.hydrating=true;
    try {
      await this.prepare();
      const cached=this.cached();
      // Never replay commands from a retired save.  In particular, an old
      // queued AI request can fail before the server has a chance to return
      // the legacy-save marker, leaving the browser stuck in read-only mode.
      if (cached && cached.rules_version !== 'fair-v3') {
        this.storage.removeItem(this.prefix+'pending');
        return this.command('reset',Number.isInteger(cached.revision)?cached.revision:0);
      }
      try {
        await this.flush();
      } catch (error) {
        // A queued command from an older catalog cannot be replayed after a
        // development data refresh.  Preserve the guest, discard that stale
        // command, and let the caller issue the explicit fair-v3 reset.
        if (['CATALOG_VERSION_UNAVAILABLE','LEGACY_SAVE_UNSUPPORTED'].includes(error.message) && this.cached()) {
          this.storage.removeItem(this.prefix+'pending');
        } else {
          throw error;
        }
      }
      try {
        view=this.cache((await this.request(this.basePath)).game,true);
      } catch (error) {
        // Existing legacy rows can reference a retired card catalog.  The
        // cached revision is sufficient for the reset command, which creates
        // a fresh fair-v3 opening without exposing the private old state.
        if (!['CATALOG_VERSION_UNAVAILABLE','LEGACY_SAVE_UNSUPPORTED'].includes(error.message) || !this.cached()) throw error;
        const old=this.cached();
        this.storage.removeItem(this.prefix+'pending');
        return this.command('reset',old.revision);
      }
    } finally {this.hydrating=false;}
    return autoJudge ? this.autoJudge(view) : view;
  }
  async autoJudge(view) {
    if(view?.card_flow)return view;
    if(['transition-v2','fair-v3'].includes(view?.rules_version) && view.narrator!=='human' && (['WAIT_TRANSITION','WAIT_ACTION','WAIT_FOLLOWUP'].includes(view.phase)||(view.rules_version==='fair-v3'&&view.phase==='ENDING_READY')))
      return this.command('generate',view.revision);
    if(view?.mode === 'cloud' && view.phase === 'WAIT_RESPONSES' && !view.segment.cloud_ready)
      return this.command('judge',view.revision,{segment_id:view.segment.id});
    return view;
  }
  async command(type, revision, fields = {}) {
    if (this.storage.getItem(this.prefix+'pending')) return this.autoJudge(await this.flush());
    const command = {...fields, command_id:uuid(), type, expected_revision:revision};
    this.storage.setItem(this.prefix+'pending', JSON.stringify(command));
    const view=await this.flush();
    return this.autoJudge(view);
  }
}
