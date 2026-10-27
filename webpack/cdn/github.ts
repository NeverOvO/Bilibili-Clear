import { jsDelivr } from './jsdelivr'
import { CdnConfig } from './types'

const owner = 'the1812'
const host = 'raw.githubusercontent.com'
export const github: CdnConfig = {
  name: 'GitHub',
  owner,
  host,
  stableClient: `https://${host}/${owner}/Bilibili-Evolved/master/dist/bilibili-evolved.user.js`,
  previewClient: `https://${host}/${owner}/Bilibili-Evolved/preview/dist/bilibili-evolved.preview.user.js`,
  library: {
    lodash: {
      url: `https://${host}/lodash/lodash/4.18.1/dist/lodash.min.js`,
      sha256: '85674f5fe0380341034b3967c1fd2c5e20a77d20e7555428e99e0e4ee699dd4d',
    },
    // The 7.6.6 release tag does not include a built dist directory.
    protobuf: jsDelivr.library.protobuf,
    fflate: jsDelivr.library.fflate,
    sortable: {
      url: `https://${host}/SortableJS/Sortable/1.14.0/Sortable.min.js`,
      sha256: '0ea5a6fbfbf5434b606878533cb7a66bcf700f0f08afe908335d0978fb63ad94',
    },
    streamsaver: {
      url: `https://${host}/jimmywarting/StreamSaver.js/2.0.6/StreamSaver.js`,
      sha256: 'a110f78e0b092481dc372901c4d57ae50681d773bc9d55e62356f9a22f17e24b',
    },
    // https://github.com/the1812/Bilibili-Evolved/pull/4521#discussion_r1402084486
    ffmpeg: jsDelivr.library.ffmpeg,
  },
  smallLogo: `https://${host}/${owner}/Bilibili-Evolved/preview/images/logo-small.png`,
  logo: `https://${host}/${owner}/Bilibili-Evolved/preview/images/logo.png`,
  root: (branch, ownerOverride) =>
    `https://${host}/${ownerOverride || owner}/Bilibili-Evolved/${branch}/`,
}
