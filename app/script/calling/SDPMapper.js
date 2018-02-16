/*
 * Wire
 * Copyright (C) 2018 Wire Swiss GmbH
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see http://www.gnu.org/licenses/.
 *
 */

'use strict';

window.z = window.z || {};
window.z.calling = z.calling || {};

z.calling.SDPMapper = {
  CONFIG: {
    AUDIO_BITRATE: '30',
    AUDIO_PTIME: '60',
  },

  /**
   * Get the tool version that generated the SDP
   * @param {string} sdpString - Full SDP string
   * @returns {string} Tool version of SDP
   */
  getToolVersion(sdpString) {
    for (const sdpLine of sdpString.split('\r\n')) {
      if (sdpLine.startsWith('a=tool')) {
        return sdpLine.replace('a=tool:', '');
      }
    }
  },

  /**
   * Map call setup message to RTCSessionDescription.
   * @param {CallMessage} callMessageEntity - Call message entity of type z.calling.enum.CALL_MESSAGE_TYPE.SETUP
   * @returns {Promise} Resolves with a webRTC standard compliant RTCSessionDescription
   */
  mapCallMessageToObject(callMessageEntity) {
    const {response, sdp: sdpString} = callMessageEntity;
    const sdp = {
      sdp: sdpString,
      type: response ? z.calling.rtc.SDP_TYPE.ANSWER : z.calling.rtc.SDP_TYPE.OFFER,
    };

    return Promise.resolve(new window.RTCSessionDescription(sdp));
  },

  /**
   * Rewrite the SDP for compatibility reasons.
   *
   * @param {RTCSessionDescription} rtcSdp - Session Description Protocol to be rewritten
   * @param {z.calling.enum.SDP_SOURCE} [sdpSource=z.calling.enum.SDP_SOURCE.REMOTE] - Source of the SDP - local or remote
   * @param {Flow} flowEntity - Flow entity
   * @returns {Object} Object containing rewritten Session Description Protocol and number of ICE candidates
   */
  rewriteSdp(rtcSdp, sdpSource = z.calling.enum.SDP_SOURCE.REMOTE, flowEntity) {
    if (!rtcSdp) {
      throw new z.calling.CallError(z.calling.CallError.TYPE.NOT_FOUND, 'Cannot rewrite undefined SDP');
    }

    if (sdpSource === z.calling.enum.SDP_SOURCE.LOCAL) {
      rtcSdp.sdp = rtcSdp.sdp.replace('UDP/TLS/', '');
    }

    const sdpLines = [];
    const iceCandidates = [];

    rtcSdp.sdp.split('\r\n').forEach(sdpLine => {
      let outline = sdpLine;

      if (sdpLine.startsWith('t=')) {
        if (sdpSource === z.calling.enum.SDP_SOURCE.LOCAL) {
          sdpLines.push(sdpLine);

          const browserString = `${z.util.Environment.browser.name} ${z.util.Environment.browser.version}`;
          const webappVersion = z.util.Environment.version(false);

          if (z.util.Environment.desktop) {
            const desktopVersion = z.util.Environment.version(true);
            outline = `a=tool:electron ${desktopVersion} ${webappVersion} (${browserString})`;
          } else {
            outline = `a=tool:webapp ${webappVersion} (${browserString})`;
          }
        }
      } else if (sdpLine.startsWith('a=candidate')) {
        iceCandidates.push(sdpLine);

        // Remove once obsolete due to high uptake of clients based on AVS build 3.3.11 containing fix for AUDIO-1215
      } else if (sdpLine.startsWith('a=mid')) {
        const isRemoteSdp = sdpSource === z.calling.enum.SDP_SOURCE.REMOTE;
        const isAnswer = rtcSdp.type === z.calling.rtc.SDP_TYPE.ANSWER;

        if (isRemoteSdp && isAnswer && z.util.Environment.browser.firefox) {
          if (sdpLine === 'a=mid:data') {
            outline = 'a=mid:sdparta_2';
          }
        }

        // Code to nail in bit-rate and ptime settings for improved performance and experience
      } else if (sdpLine.startsWith('m=audio')) {
        const isIceRestart = flowEntity.negotiation_mode() === z.calling.enum.SDP_NEGOTIATION_MODE.ICE_RESTART;
        const isLocalSdp = sdpSource === z.calling.enum.SDP_SOURCE.LOCAL;

        if (isIceRestart || (isLocalSdp && flowEntity.isGroup)) {
          sdpLines.push(sdpLine);
          outline = `b=AS:${z.calling.SDPMapper.CONFIG.AUDIO_BITRATE}`;
        }
      } else if (sdpLine.startsWith('a=rtpmap')) {
        const isIceRestart = flowEntity.negotiation_mode() === z.calling.enum.SDP_NEGOTIATION_MODE.ICE_RESTART;
        const isLocalSdp = sdpSource === z.calling.enum.SDP_SOURCE.LOCAL;

        if (isIceRestart || (isLocalSdp && flowEntity.isGroup)) {
          if (z.util.StringUtil.includes(sdpLine, 'opus')) {
            sdpLines.push(sdpLine);
            outline = `a=ptime:${z.calling.SDPMapper.CONFIG.AUDIO_PTIME}`;
          }
        }

        // Workaround for incompatibility between Chrome 57 and AVS builds. Remove once update of clients with AVS 3.3.x is high enough.
      } else if (sdpLine.startsWith('a=fmtp')) {
        if (sdpLine === 'a=fmtp:125 apt=100') {
          outline = 'a=fmtp:125 apt=96';
        }
      }

      if (outline !== undefined) {
        sdpLines.push(outline);
      }
    });

    rtcSdp.sdp = sdpLines.join('\r\n');
    return Promise.resolve({iceCandidates: iceCandidates, sdp: rtcSdp});
  },
};
