import { CdnConfig } from './types'

const owner = 'the1812'
const host = 'cdn.jsdelivr.net'
export const jsDelivr: CdnConfig = {
  name: 'jsDelivr',
  owner,
  host,
  stableClient: `https://${host}/gh/${owner}/Bilibili-Evolved@master/dist/bilibili-evolved.user.js`,
  previewClient: `https://${host}/gh/${owner}/Bilibili-Evolved@preview/dist/bilibili-evolved.preview.user.js`,
  library: {
    lodash: {
      url: `https://${host}/npm/lodash@4.18.1/lodash.min.js`,
      sha256: 'a8d7e6291ad80256f976ace90824a71018d2f706992c9107b20bdced97bee27b',
    },
    protobuf: {
      url: `https://${host}/npm/protobufjs@7.6.6/dist/light/protobuf.min.js`,
      sha256: 'b4f1c5131528ae8bccb8487bd0e78b34e330d4d2222356b46abcf2e341f3df6c',
    },
    fflate: {
      url: `https://${host}/npm/fflate@0.8.3/umd/index.js`,
      sha256: '462ef8041fc970e3615a20a9dd2b2e3047a073b2da729ef4f02b634bba8b7b83',
    },
    sortable: {
      url: `https://${host}/npm/sortablejs@1.14.0/Sortable.min.js`,
      sha256: '0ea5a6fbfbf5434b606878533cb7a66bcf700f0f08afe908335d0978fb63ad94',
    },
    streamsaver: {
      url: `https://${host}/npm/streamsaver@2.0.6/StreamSaver.js`,
      sha256: 'a110f78e0b092481dc372901c4d57ae50681d773bc9d55e62356f9a22f17e24b',
    },
    ffmpeg: {
      worker: {
        url: `https://${host}/npm/@ffmpeg/ffmpeg@0.12.4/dist/umd/814.ffmpeg.js`,
        sha256: 'baf19437171b1bccae4416e4da69fb40455b8e67142f79c8ec9da36b1de7fd8a',
      },
      core: {
        url: `https://${host}/npm/@ffmpeg/core@0.12.4/dist/umd/ffmpeg-core.js`,
        sha256: '6af6b8cd8c878dec6f61f3cd6be16e88f9391dd265e51f20afea5c0f718bfba0',
      },
      wasm: {
        url: `https://${host}/npm/@ffmpeg/core@0.12.4/dist/umd/ffmpeg-core.wasm`,
        sha256: '81bdc645b71d7d74ff56fdc0979c5fcb2f92ffcc7f24573a79681fed4ea73905',
      },
    },
  },
  smallLogo: `https://${host}/gh/${owner}/Bilibili-Evolved@preview/images/logo-small.png`,
  logo: `https://${host}/gh/${owner}/Bilibili-Evolved@preview/images/logo.png`,
  root: (branch, ownerOverride) =>
    `https://${host}/gh/${ownerOverride || owner}/Bilibili-Evolved@${branch}/`,
}
