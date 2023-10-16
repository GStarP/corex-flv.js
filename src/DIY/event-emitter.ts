import { EventEmitter, Listener } from 'events';

// @DIY 很多类里都有相同代码，故直接抽取出来
class EventEmitterBase {
  _emitter: EventEmitter;

  constructor() {
    this._emitter = new EventEmitter();
  }

  // 代理 EventEmitter 相关方法
  on(event: string, listener: Listener) {
    this._emitter.addListener(event, listener);
  }
  off(event: string, listener: Listener) {
    this._emitter.removeListener(event, listener);
  }
}

export default EventEmitterBase;
