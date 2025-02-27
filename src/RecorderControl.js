/**
 * @file 公共的 Web Audio API Context
 * @author BenzLeung(https://github.com/BenzLeung)
 * @date 2017/11/12
 * Created by JetBrains PhpStorm.
 *
 * 每位工程师都有保持代码优雅的义务
 * each engineer has a duty to keep the code elegant
 */

import Recorder from 'benz-recorderjs';

const AudioContext = window.AudioContext || window.webkitAudioContext || window.mozAudioContext;

let ctx = null;
let isSupport = true;

window.resetAudioContext = () => {
    if (ctx) {
        ctx.close().then(() => {
            ctx = null;
            ctx = new AudioContext();
        });
    } else {
        if (AudioContext) {
            ctx = new AudioContext();
        } else {
            isSupport = false;
        }
    }
};

window.resetAudioContext();

export default class RecorderControl {
    _recorderStream = null;
    _recorderStreamSourceNode = null;
    _recorder = null;
    _isRecording = false;
    _playbackRate = null

    _curSourceNode = null;

    playPcm(samples, sampleRate, onEnded, startPos, audioType) {
        let changeSampleRate = 8000;
        // 针对 amr-wb进行采样率翻倍
        if (audioType && audioType === 'audio/amr-wb') {
            changeSampleRate = 16000;
        } else {
            changeSampleRate = sampleRate;
        }

        sampleRate = changeSampleRate;
        this.stopPcm();

        // 根据开始位置（秒数）截取播放采样
        let _samples = (startPos && startPos > 0.001) ? samples.slice(sampleRate * startPos) : samples;
        if (!_samples || !_samples.length) {
            return onEnded();
        }
        let buffer, channelBuffer;
        this._curSourceNode = ctx['createBufferSource']();

        try {
            console.log('[root- playPcm try 采样率] ', sampleRate);
            buffer = ctx['createBuffer'](1, _samples.length, sampleRate);
        } catch (e) {
            console.log('[root- playPcm catch 采样率]', sampleRate);
            // iOS 不支持 22050 以下的采样率，于是先提升采样率，然后用慢速播放
            if (sampleRate < 11025) {
                buffer = ctx['createBuffer'](1, _samples.length, sampleRate * 4);

                this._curSourceNode['playbackRate'].value = 0.25;
            } else {
                buffer = ctx['createBuffer'](1, _samples.length, sampleRate * 2);
                this._curSourceNode['playbackRate'].value = 0.5;
            }
        }
        if (buffer['copyToChannel']) {
            buffer['copyToChannel'](_samples, 0, 0);
        } else {
            channelBuffer = buffer['getChannelData'](0);
            channelBuffer.set(_samples);
        }
        this._curSourceNode['buffer'] = buffer;
        this._curSourceNode['loop'] = false;
        this._curSourceNode['connect'](ctx['destination']);
        this._playbackRate = this._playbackRate ? this._playbackRate : this._curSourceNode['playbackRate'].value;
        this._curSourceNode.onended = onEnded;
        this._curSourceNode.start();
    }

    stopPcm() {
        if (this._curSourceNode) {
            this._curSourceNode.stop();
            this._curSourceNode = null;
        }
    }

    stopPcmSilently() {
        this._curSourceNode.onended = null;
        this.stopPcm();
    }

    playbackRate(value) {
        this._curSourceNode['playbackRate'].value = value;
    }

    initRecorder() {
        return new Promise((resolve, reject) => {
            let s = (stream) => {
                this._recorderStream = stream;
                this._recorderStreamSourceNode = ctx.createMediaStreamSource(stream);
                this._recorder = new Recorder(this._recorderStreamSourceNode);
                this._isRecording = false;
                resolve();
            };
            let j = (e) => {
                reject(e);
            };
            if (!this._recorder) {
                if (window.navigator.mediaDevices && window.navigator.mediaDevices.getUserMedia) {
                    window.navigator.mediaDevices.getUserMedia({ audio: true }).then(s).catch(j);
                } else if (window.navigator.getUserMedia) {
                    window.navigator.getUserMedia({ audio: true }, s, j);
                } else {
                    j();
                }
            } else {
                resolve();
            }
        });
    }

    isRecording() {
        return this._recorder && this._isRecording;
    }

    startRecord() {
        if (this._recorder) {
            this._recorder.clear();
            this._recorder.record();
            this._isRecording = true;
        }
    }

    stopRecord() {
        if (this._recorder) {
            this._recorder.stop();
            this._isRecording = false;
        }
    }

    generateRecordSamples() {
        return new Promise((resolve) => {
            if (this._recorder) {
                this._recorder.getBuffer((buffers) => {
                    resolve(buffers[0]);
                });
            }
        });
    }

    releaseRecord() {
        if (this._recorderStream && this._recorderStream.getTracks) {
            this._recorderStream.getTracks().forEach((track) => {
                track.stop();
            });
            this._recorderStream = null;
        }
        if (this._recorder) {
            this._recorder.release();
            this._recorder = null;
        }
    }

    static isPlaySupported() {
        return isSupport;
    }

    static isRecordSupported() {
        return !!(
            (window.navigator.mediaDevices && window.navigator.mediaDevices.getUserMedia) ||
            window.navigator.getUserMedia
        );
    }

    static getCtxSampleRate() {
        return ctx.sampleRate;
    }

    static getCtxTime() {
        return ctx.currentTime;
    }

    static decodeAudioArrayBufferByContext(array) {
        return new Promise((resolve, reject) => {
            ctx['decodeAudioData'](
                array,
                (audioBuf) => {
                    // 把多声道音频 mix 成单声道
                    const numberOfChannels = audioBuf.numberOfChannels;
                    let dest = new Float32Array(audioBuf.length);

                    switch (numberOfChannels) {
                        default:
                        case 1: {
                            dest = audioBuf.getChannelData(0);
                            break;
                        }
                        case 2: {
                            const left = audioBuf.getChannelData(0);
                            const right = audioBuf.getChannelData(1);
                            for (let i = 0, l = dest.length; i < l; i++) {
                                dest[i] = 0.5 * (left[i] + right[i]);
                            }
                            break;
                        }
                        case 4: {
                            const left = audioBuf.getChannelData(0);
                            const right = audioBuf.getChannelData(1);
                            const sLeft = audioBuf.getChannelData(2);
                            const sRight = audioBuf.getChannelData(3);
                            for (let i = 0, l = dest.length; i < l; i++) {
                                dest[i] = 0.25 * (left[i] + right[i] + sLeft[i] + sRight[i]);
                            }
                            break;
                        }
                        case 6: {
                            const left = audioBuf.getChannelData(0);
                            const right = audioBuf.getChannelData(1);
                            const center = audioBuf.getChannelData(2);
                            const sLeft = audioBuf.getChannelData(4);
                            const sRight = audioBuf.getChannelData(5);
                            for (let i = 0, l = dest.length; i < l; i++) {
                                dest[i] =
                                    0.7071 * (left[i] + right[i]) +
                                    center[i] +
                                    0.5 * (sLeft[i] + sRight[i]);
                            }
                            break;
                        }
                    }
                    resolve(dest);
                },
                reject
            );
        });
    }

    /*
    static _increaseSampleRate(samples, multiple) {
        let sampleLen = samples.length;
        let newSamples = new Float32Array(sampleLen * multiple);
        for (let i = 0; i < sampleLen; i ++) {
            for (let j = 0; j < multiple; j ++) {
                newSamples[i * multiple + j] = samples[i];
            }
        }
        return newSamples;
    };
    */
}
