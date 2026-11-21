// <media-bar for="id of a video">: a mock of customisable media controls.
// The native controls of a <video> are a closed tree: a page can style some of it and cannot reach any
// of it from script. This element is what a customisable version could look like to a page. Its four
// controls are ordinary elements in an open shadow tree, each named with part="", and the player's
// state is exposed as custom states, so CSS outside can write media-bar:state(playing).

// #region element
const TEMPLATE = `<style>
  :host { box-sizing: border-box; display: flex; align-items: center; gap: 8px; padding: 6px 10px; color: #fff; font: 14px system-ui, sans-serif; }
  button { box-sizing: border-box; flex: none; min-width: 44px; height: 40px; margin: 0; padding: 0 10px; border: 1px solid rgb(255 255 255 / 0.5); border-radius: 20px; background: rgb(0 0 0 / 0.35); color: #fff; font: 600 14px system-ui, sans-serif; }
  input { flex: 1; min-width: 0; height: 40px; margin: 0; accent-color: #ff7a3c; }
  span { flex: none; min-width: 34px; font-variant-numeric: tabular-nums; text-align: right; }
</style>
<button part="play" type="button" aria-label="Play">Play</button>
<input part="timeline" type="range" min="0" max="1000" value="0" aria-label="Position in the film">
<span part="time">0:00</span>
<button part="mute" type="button" aria-label="Sound" aria-pressed="false">Sound</button>`;

class MediaBar extends HTMLElement {
  static observedAttributes = ['for', 'lift'];
  #internals = this.attachInternals();
  #video = null;
  #stop = null;
  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = TEMPLATE;
    const [play, timeline, time, mute] = root.querySelectorAll('[part]');
    this.parts = { play, timeline, time, mute };
    play.addEventListener('click', () => { const v = this.#video; if (v) v.paused ? v.play() : v.pause(); });
    mute.addEventListener('click', () => { if (this.#video) this.#video.muted = !this.#video.muted; });
    timeline.addEventListener('input', () => { const v = this.#video; if (v && v.duration) v.currentTime = timeline.value / 1000 * v.duration; });
  }
  connectedCallback() { this.#bind(); }
  disconnectedCallback() { this.#stop?.abort(); }
  attributeChangedCallback(name) {
    if (name === 'for' && this.isConnected) this.#bind();
    // With the lift attribute each part is drawable, so a canvas can draw the four parts as four pictures.
    if (name === 'lift') for (const part of Object.values(this.parts)) part.toggleAttribute('drawable', this.hasAttribute('lift'));
  }
  #bind() {
    this.#stop?.abort();
    this.#stop = new AbortController();
    const video = this.#video = this.getRootNode().getElementById?.(this.getAttribute('for')) ?? null;
    if (!video) return;
    for (const type of ['play', 'pause', 'ended', 'timeupdate', 'seeked', 'volumechange', 'durationchange', 'loadedmetadata']) {
      video.addEventListener(type, () => this.#read(), { signal: this.#stop.signal });
    }
    this.#read();
  }
  // Copy the video's state to the parts and to the custom states.
  #read() {
    const v = this.#video, { play, timeline, time, mute } = this.parts, states = this.#internals.states;
    const set = (name, on) => { if (on) states.add(name); else states.delete(name); };
    set('playing', !v.paused && !v.ended);
    set('ended', v.ended);
    set('muted', v.muted);
    const label = v.paused || v.ended ? 'Play' : 'Pause';
    if (play.textContent !== label) { play.textContent = label; play.setAttribute('aria-label', label); }
    const muted = v.muted ? 'Muted' : 'Sound';
    if (mute.textContent !== muted) { mute.textContent = muted; mute.setAttribute('aria-pressed', String(v.muted)); }
    const at = v.currentTime || 0, text = `${Math.floor(at / 60)}:${String(Math.floor(at % 60)).padStart(2, '0')}`;
    if (time.textContent !== text) time.textContent = text;
    const value = String(v.duration ? Math.round(at / v.duration * 1000) : 0);
    if (timeline.value !== value && this.shadowRoot.activeElement !== timeline) timeline.value = value;
  }
}
if (!customElements.get('media-bar')) customElements.define('media-bar', MediaBar);
// #endregion element
