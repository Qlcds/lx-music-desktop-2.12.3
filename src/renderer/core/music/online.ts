import { updateListMusics } from '@renderer/store/list/action'
import { appSetting } from '@renderer/store/setting'
import {
  saveLyric,
  saveMusicUrl,
  getMusicUrl as getStoreMusicUrl,
} from '@renderer/utils/ipc'
import { requestMsg } from '@renderer/utils/message'
import {
  buildLyricInfo,
  getCachedLyricInfo,
  getOtherSource,
  getOnlineOtherSourceMusicUrl,
  getPlayQualityList,
  handleGetOnlineLyricInfo,
  handleGetOnlineMusicUrl,
  handleGetOnlinePicUrl,
} from './utils'

/* export const setMusicUrl = ({ musicInfo, type, url }: {
  musicInfo: LX.Music.MusicInfo
  type: LX.Quality
  url: string
}) => {
  saveMusicUrl(musicInfo, type, url)
}

export const setPic = (datas: {
  listId: string
  musicInfo: LX.Music.MusicInfo
  url: string
}) => {
  datas.musicInfo.img = datas.url
  updateMusicInfo({
    listId: datas.listId,
    id: datas.musicInfo.songmid,
    data: { img: datas.url },
    musicInfo: datas.musicInfo,
  })
}
 */


export const getMusicUrl = async({ musicInfo, quality, isRefresh, allowToggleSource = true, onToggleSource = () => {} }: {
  musicInfo: LX.Music.MusicInfoOnline
  quality?: LX.Quality
  isRefresh: boolean
  allowToggleSource?: boolean
  onToggleSource?: (musicInfo?: LX.Music.MusicInfoOnline) => void
}): Promise<string> => {
  // 所选音质到 128k 之间的降级尝试序列；指定 quality 时则只尝试该档
  const tryQualitys = quality ? [quality] : getPlayQualityList(appSetting['player.playQuality'], musicInfo)
  let lastError: Error | null = null

  for (const itemQuality of tryQualitys) {
    const cachedUrl = await getStoreMusicUrl(musicInfo, itemQuality)
    if (cachedUrl && !isRefresh) return cachedUrl
    try {
      const { url, quality: targetQuality, musicInfo: targetMusicInfo } = await handleGetOnlineMusicUrl({
        musicInfo,
        quality: itemQuality,
        onToggleSource,
        isRefresh,
        allowToggleSource: false,
      })
      if (targetMusicInfo.id != musicInfo.id) void saveMusicUrl(targetMusicInfo, targetQuality, url)
      void saveMusicUrl(musicInfo, targetQuality, url)
      return url
    } catch (err: any) {
      if (err?.message == requestMsg.tooManyRequests) throw err
      lastError = err
      console.log(err)
    }
  }

  // 同源各档位全部失败，才尝试切换其他来源（在该来源上按所选音质自行降级）
  if (allowToggleSource) {
    onToggleSource()
    const otherSource = await getOtherSource(musicInfo)
    console.log('find otherSource', otherSource)
    if (otherSource.length) {
      const { url, quality: targetQuality, musicInfo: targetMusicInfo } = await getOnlineOtherSourceMusicUrl({
        musicInfos: [...otherSource],
        quality,
        onToggleSource,
        isRefresh,
        retryedSource: [musicInfo.source],
      })
      void saveMusicUrl(targetMusicInfo, targetQuality, url)
      return url
    }
  }

  throw lastError ?? new Error(window.i18n.t('toggle_source_failed'))
}

export const getPicUrl = async({ musicInfo, listId, isRefresh, allowToggleSource = true, onToggleSource = () => {} }: {
  musicInfo: LX.Music.MusicInfoOnline
  listId?: string | null
  isRefresh: boolean
  allowToggleSource?: boolean
  onToggleSource?: (musicInfo?: LX.Music.MusicInfoOnline) => void
}): Promise<string> => {
  if (musicInfo.meta.picUrl && !isRefresh) return musicInfo.meta.picUrl
  return handleGetOnlinePicUrl({ musicInfo, onToggleSource, isRefresh, allowToggleSource }).then(({ url, musicInfo: targetMusicInfo, isFromCache }) => {
    // picRequest = null
    if (listId) {
      musicInfo.meta.picUrl = url
      void updateListMusics([{ id: listId, musicInfo }])
    }
    // savePic({ musicInfo, url, listId })
    return url
  })
}
export const getLyricInfo = async({ musicInfo, isRefresh, allowToggleSource = true, onToggleSource = () => {} }: {
  musicInfo: LX.Music.MusicInfoOnline
  isRefresh: boolean
  allowToggleSource?: boolean
  onToggleSource?: (musicInfo?: LX.Music.MusicInfoOnline) => void
}): Promise<LX.Player.LyricInfo> => {
  if (!isRefresh) {
    const lyricInfo = await getCachedLyricInfo(musicInfo)
    if (lyricInfo) return buildLyricInfo(lyricInfo)
  }

  // lrcRequest = music[musicInfo.source].getLyric(musicInfo)
  return handleGetOnlineLyricInfo({ musicInfo, onToggleSource, isRefresh, allowToggleSource }).then(async({ lyricInfo, musicInfo: targetMusicInfo, isFromCache }) => {
    // lrcRequest = null
    if (isFromCache) return buildLyricInfo(lyricInfo)
    if (targetMusicInfo.id == musicInfo.id) void saveLyric(musicInfo, lyricInfo)
    else void saveLyric(targetMusicInfo, lyricInfo)

    return buildLyricInfo(lyricInfo)
  })
}
