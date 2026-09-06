import { QUALITYS } from '@common/constants'
import { qualityList } from '@renderer/store'
import { assertApiSupport } from '@renderer/store/utils'
import musicSdk from '@renderer/utils/musicSdk'
import {
  // getOtherSource as getOtherSourceFromStore,
  // saveOtherSource as saveOtherSourceFromStore,
  getMusicUrl as getStoreMusicUrl,
  getPlayerLyric as getStoreLyric,
} from '@renderer/utils/ipc'
import { appSetting } from '@renderer/store/setting'
import { langS2T, toNewMusicInfo, toOldMusicInfo } from '@renderer/utils'
import { requestMsg } from '@renderer/utils/message'
import { apis } from '@renderer/utils/musicSdk/api-source'


const getOtherSourcePromises = new Map()
const otherSourceCache = new Map<LX.Music.MusicInfo | LX.Download.ListItem, LX.Music.MusicInfoOnline[]>()
export const existTimeExp = /\[\d{1,2}:.*\d{1,4}\]/

export const getOtherSource = async(musicInfo: LX.Music.MusicInfo | LX.Download.ListItem, isRefresh = false): Promise<LX.Music.MusicInfoOnline[]> => {
  // if (!isRefresh && musicInfo.id) {
  //   const cachedInfo = await getOtherSourceFromStore(musicInfo.id)
  //   if (cachedInfo.length) return cachedInfo
  // }
  if (otherSourceCache.has(musicInfo)) return otherSourceCache.get(musicInfo)!
  let key: string
  let searchMusicInfo: {
    name: string
    singer: string
    source: string
    albumName: string
    interval: string
  }
  if ('progress' in musicInfo) {
    key = `local_${musicInfo.id}`
    searchMusicInfo = {
      name: musicInfo.metadata.musicInfo.name,
      singer: musicInfo.metadata.musicInfo.singer,
      source: musicInfo.metadata.musicInfo.source,
      albumName: musicInfo.metadata.musicInfo.meta.albumName,
      interval: musicInfo.metadata.musicInfo.interval ?? '',
    }
  } else {
    key = `${musicInfo.source}_${musicInfo.id}`
    searchMusicInfo = {
      name: musicInfo.name,
      singer: musicInfo.singer,
      source: musicInfo.source,
      albumName: musicInfo.meta.albumName,
      interval: musicInfo.interval ?? '',
    }
  }
  if (getOtherSourcePromises.has(key)) return getOtherSourcePromises.get(key)

  const promise = new Promise<LX.Music.MusicInfoOnline[]>((resolve, reject) => {
    let timeout: null | NodeJS.Timeout = setTimeout(() => {
      timeout = null
      reject(new Error('find music timeout'))
    }, 15_000)
    musicSdk.findMusic(searchMusicInfo).then((otherSource) => {
      if (otherSourceCache.size > 10) otherSourceCache.clear()
      const source = otherSource.map(toNewMusicInfo) as LX.Music.MusicInfoOnline[]
      otherSourceCache.set(musicInfo, source)
      resolve(source)
    }).catch(reject).finally(() => {
      if (timeout) clearTimeout(timeout)
    })
  }).then((otherSource) => {
    // if (otherSource.length) void saveOtherSourceFromStore(musicInfo.id, otherSource)
    return otherSource
  }).finally(() => {
    if (getOtherSourcePromises.has(key)) getOtherSourcePromises.delete(key)
  })
  getOtherSourcePromises.set(key, promise)
  return promise
}


export const buildLyricInfo = async(lyricInfo: MakeOptional<LX.Player.LyricInfo, 'rawlrcInfo'>): Promise<LX.Player.LyricInfo> => {
  if (!appSetting['player.isS2t']) {
    // @ts-expect-error
    if (lyricInfo.rawlrcInfo) return lyricInfo
    return { ...lyricInfo, rawlrcInfo: { ...lyricInfo } }
  }

  if (appSetting['player.isS2t']) {
    const tasks = [
      lyricInfo.lyric ? langS2T(lyricInfo.lyric) : Promise.resolve(''),
      lyricInfo.tlyric ? langS2T(lyricInfo.tlyric) : Promise.resolve(''),
      lyricInfo.rlyric ? langS2T(lyricInfo.rlyric) : Promise.resolve(''),
      lyricInfo.lxlyric ? langS2T(lyricInfo.lxlyric) : Promise.resolve(''),
    ]
    if (lyricInfo.rawlrcInfo) {
      tasks.push(lyricInfo.lyric ? langS2T(lyricInfo.lyric) : Promise.resolve(''))
      tasks.push(lyricInfo.tlyric ? langS2T(lyricInfo.tlyric) : Promise.resolve(''))
      tasks.push(lyricInfo.rlyric ? langS2T(lyricInfo.rlyric) : Promise.resolve(''))
      tasks.push(lyricInfo.lxlyric ? langS2T(lyricInfo.lxlyric) : Promise.resolve(''))
    }
    return Promise.all(tasks).then(([lyric, tlyric, rlyric, lxlyric, lyric_raw, tlyric_raw, rlyric_raw, lxlyric_raw]) => {
      const rawlrcInfo = lyric_raw ? {
        lyric: lyric_raw,
        tlyric: tlyric_raw,
        rlyric: rlyric_raw,
        lxlyric: lxlyric_raw,
      } : {
        lyric,
        tlyric,
        rlyric,
        lxlyric,
      }
      return {
        lyric,
        tlyric,
        rlyric,
        lxlyric,
        rawlrcInfo,
      }
    })
  }

  // @ts-expect-error
  return lyricInfo.rawlrcInfo ? lyricInfo : { ...lyricInfo, rawlrcInfo: { ...lyricInfo } }
}

export const getCachedLyricInfo = async(musicInfo: LX.Music.MusicInfo): Promise<LX.Player.LyricInfo | null> => {
  let lrcInfo = await getStoreLyric(musicInfo)
  // lrcInfo = {} as unknown as LX.Player.LyricInfo
  if (existTimeExp.test(lrcInfo.lyric)) {
    if (lrcInfo.tlyric != null) {
      // if (musicInfo.lrc.startsWith('\ufeff[id:$00000000]')) {
      //   let str = musicInfo.lrc.replace('\ufeff[id:$00000000]\n', '')
      //   commit('setLrc', { musicInfo, lyric: str, tlyric: musicInfo.tlrc, lxlyric: musicInfo.tlrc })
      // } else if (musicInfo.lrc.startsWith('[id:$00000000]')) {
      //   let str = musicInfo.lrc.replace('[id:$00000000]\n', '')
      //   commit('setLrc', { musicInfo, lyric: str, tlyric: musicInfo.tlrc, lxlyric: musicInfo.tlrc })
      // }

      if (lrcInfo.lxlyric == null) {
        switch (musicInfo.source) { // 以下源支持lxlyric 重新获取
          case 'kg':
          case 'kw':
          case 'mg':
          case 'wy':
          case 'tx':
            break
          default:
            return lrcInfo
        }
      } else if (lrcInfo.rlyric == null) {
        // 以下源支持 rlyric 重新获取
        if (!['wy', 'kg', 'tx'].includes(musicInfo.source)) return lrcInfo
      } else return lrcInfo
    }
    if (musicInfo.source == 'local') return lrcInfo
  }
  return null
}

export const getOnlineOtherSourceMusicUrlByLocal = async(musicInfo: LX.Music.MusicInfoLocal, isRefresh: boolean): Promise<{
  url: string
  quality: LX.Quality
  isFromCache: boolean
}> => {
  if (!await window.lx.apiInitPromise[0]) throw new Error('source init failed')

  const quality = '128k'

  const cachedUrl = await getStoreMusicUrl(musicInfo, quality)
  if (cachedUrl && !isRefresh) return { url: cachedUrl, quality, isFromCache: true }

  let reqPromise
  try {
    reqPromise = apis('local').getMusicUrl(toOldMusicInfo(musicInfo), null).promise
  } catch (err: any) {
    reqPromise = Promise.reject(err)
  }

  return reqPromise.then(({ url }: { url: string }) => {
    return { url, quality, isFromCache: false }
  })
}

export const getOnlineOtherSourceLyricByLocal = async(musicInfo: LX.Music.MusicInfoLocal, isRefresh: boolean): Promise<{
  lyricInfo: LX.Music.LyricInfo
  isFromCache: boolean
}> => {
  if (!await window.lx.apiInitPromise[0]) throw new Error('source init failed')

  const lyricInfo = await getCachedLyricInfo(musicInfo)
  if (lyricInfo && !isRefresh) return { lyricInfo, isFromCache: true }

  let reqPromise
  try {
    reqPromise = apis('local').getLyric(toOldMusicInfo(musicInfo)).promise
  } catch (err: any) {
    reqPromise = Promise.reject(err)
  }

  return reqPromise.then((lyricInfo: LX.Music.LyricInfo) => {
    return { lyricInfo, isFromCache: false }
  })
}

export const getOnlineOtherSourcePicByLocal = async(musicInfo: LX.Music.MusicInfoLocal): Promise<{
  url: string
}> => {
  if (!await window.lx.apiInitPromise[0]) throw new Error('source init failed')

  let reqPromise
  try {
    reqPromise = apis('local').getPic(toOldMusicInfo(musicInfo)).promise
  } catch (err: any) {
    reqPromise = Promise.reject(err)
  }

  return reqPromise.then((url: string) => {
    return { url }
  })
}

/** 播放可选的音质档位（高→低），设置页的“优先播放的音质”选项由此生成 */
export const PLAY_QUALITYS = ['master', 'atmos', 'flac24bit', 'flac', '320k', '128k'] as const

/** 音质档位的展示文案（列表音质小标用） */
export const QUALITY_TEXT: Partial<Record<LX.Quality, string>> = {
  master: 'Master',
  atmos: 'Atmos',
  flac24bit: '24bit',
  flac: 'Flac',
  wav: 'Wav',
  ape: 'Ape',
  '320k': '320K',
  '192k': '192K',
  '128k': '128K',
}

/** 取某首在线歌曲已宣称的最高可用音质（高→低），无则返回 null */
export const getMusicHighestQuality = (musicInfo: LX.Music.MusicInfo): LX.Quality | null => {
  const _qualitys = (musicInfo as LX.Music.MusicInfoOnline).meta?._qualitys
  if (!_qualitys) return null
  return QUALITYS.find(type => _qualitys[type]) ?? null
}

/**
 * 列表展示用的最高音质：把解析出的最高档按“当前音源声明支持的上限”强制提升到 master/atmos。
 * 仅当该曲解析结果已达无损级及以上时才提升，避免把低码率歌曲误标为母带。
 * 列表解析结果最高只到 flac24bit，而音源可能实际能取到 Master/Atmos；
 * 播放侧已有“失败自动降级”兜底，因此这里的“高估”是安全的。
 */
export const getSongDisplayQuality = (musicInfo: LX.Music.MusicInfoOnline): LX.Quality | null => {
  const parsedTop = getMusicHighestQuality(musicInfo)
  if (!parsedTop) return null
  const sourceList = qualityList.value[musicInfo.source]
  const sourceTop = sourceList?.length ? sourceList[sourceList.length - 1] : null
  if (sourceTop == 'atmos' || sourceTop == 'master') {
    const parsedIndex = QUALITYS.indexOf(parsedTop)
    const flacIndex = QUALITYS.indexOf('flac')
    if (parsedIndex != -1 && parsedIndex <= flacIndex) {
      // 无损及以上，按音源上限强制显示最高音质
      return sourceTop
    }
  }
  return parsedTop
}

/**
 * 根据“优先播放的音质”与歌曲/播放源的实际情况，生成从高到低可尝试的音质序列。
 * 规则：在所选档位及以下（高→低）中，仅保留
 *   1) 播放源(qualityList) 声明支持的档位，和
 *   2) 该歌曲数据中已标记的档位，或与所选档位一致（用于 Master/Atmos 这种“首选即尝试”的档）。
 * 保证至少返回一个兜底档位（128k）。
 */
export const getPlayQualityList = (highQuality: LX.Quality, musicInfo: LX.Music.MusicInfoOnline): LX.Quality[] => {
  const sourceList = qualityList.value[musicInfo.source]
  const index = PLAY_QUALITYS.indexOf(highQuality as typeof PLAY_QUALITYS[number])
  const candidates = (index > -1 ? PLAY_QUALITYS.slice(index) : [...PLAY_QUALITYS]) as LX.Quality[]
  const _qualitys = musicInfo.meta?._qualitys ?? {}
  const list = candidates.filter(q =>
    (sourceList?.includes(q) ?? false) &&
    (_qualitys[q] || q == highQuality),
  )
  if (list.length) return list
  if (sourceList?.length) return [sourceList[0]]
  return ['128k']
}

export const getPlayQuality = (highQuality: LX.Quality, musicInfo: LX.Music.MusicInfoOnline): LX.Quality => {
  return getPlayQualityList(highQuality, musicInfo)[0] ?? '128k'
}

export const getOnlineOtherSourceMusicUrl = async({ musicInfos, quality, onToggleSource, isRefresh, retryedSource = [] }: {
  musicInfos: LX.Music.MusicInfoOnline[]
  quality?: LX.Quality
  onToggleSource: (musicInfo?: LX.Music.MusicInfoOnline) => void
  isRefresh: boolean
  retryedSource?: LX.OnlineSource[]
}): Promise<{
  url: string
  musicInfo: LX.Music.MusicInfoOnline
  quality: LX.Quality
  isFromCache: boolean
}> => {
  if (!await window.lx.apiInitPromise[0]) throw new Error('source init failed')

  const highQuality = quality ?? appSetting['player.playQuality']
  let lastError: Error | null = null
  let musicInfo: LX.Music.MusicInfoOnline | null = null
  // eslint-disable-next-line no-cond-assign
  while (musicInfo = (musicInfos.shift()!)) {
    if (retryedSource.includes(musicInfo.source)) continue
    retryedSource.push(musicInfo.source)
    if (!assertApiSupport(musicInfo.source)) continue
    const tryQualitys = quality ? [quality] : getPlayQualityList(highQuality, musicInfo)
    if (!tryQualitys.length) continue

    console.log('try toggle to: ', musicInfo.source, musicInfo.name, musicInfo.singer, musicInfo.interval)
    onToggleSource(musicInfo)
    for (const itemQuality of tryQualitys) {
      const cachedUrl = await getStoreMusicUrl(musicInfo, itemQuality)
      if (cachedUrl && !isRefresh) return { url: cachedUrl, musicInfo, quality: itemQuality, isFromCache: true }

      let reqPromise
      try {
        reqPromise = musicSdk[musicInfo.source].getMusicUrl(toOldMusicInfo(musicInfo), itemQuality).promise
      } catch (err: any) {
        reqPromise = Promise.reject(err)
      }
      try {
        const { url, type } = await reqPromise as { url: string, type: LX.Quality }
        return { musicInfo, url, quality: type, isFromCache: false }
      } catch (err: any) {
        if (err.message == requestMsg.tooManyRequests) throw err
        lastError = err
        console.log(err)
      }
    }
  }
  throw lastError ?? new Error(window.i18n.t('toggle_source_failed'))
}

/**
 * 获取在线音乐URL
 */
export const handleGetOnlineMusicUrl = async({ musicInfo, quality, onToggleSource, isRefresh, allowToggleSource }: {
  musicInfo: LX.Music.MusicInfoOnline
  quality?: LX.Quality
  isRefresh: boolean
  allowToggleSource: boolean
  onToggleSource: (musicInfo?: LX.Music.MusicInfoOnline) => void
}): Promise<{
  url: string
  musicInfo: LX.Music.MusicInfoOnline
  quality: LX.Quality
  isFromCache: boolean
}> => {
  if (!await window.lx.apiInitPromise[0]) throw new Error('source init failed')
  // console.log(musicInfo.source)
  const targetQuality = quality ?? getPlayQuality(appSetting['player.playQuality'], musicInfo)

  let reqPromise
  try {
    reqPromise = musicSdk[musicInfo.source].getMusicUrl(toOldMusicInfo(musicInfo), targetQuality).promise
  } catch (err: any) {
    reqPromise = Promise.reject(err)
  }
  return reqPromise.then(({ url, type }: { url: string, type: LX.Quality }) => {
    return { musicInfo, url, quality: type, isFromCache: false }
  }).catch(async(err: any) => {
    console.log(err)
    if (!allowToggleSource || err.message == requestMsg.tooManyRequests) throw err
    onToggleSource()
    // eslint-disable-next-line @typescript-eslint/promise-function-async
    return getOtherSource(musicInfo).then(otherSource => {
      console.log('find otherSource', otherSource)
      if (otherSource.length) {
        return getOnlineOtherSourceMusicUrl({
          musicInfos: [...otherSource],
          onToggleSource,
          quality,
          isRefresh,
          retryedSource: [musicInfo.source],
        })
      }
      throw err
    })
  })
}


export const getOnlineOtherSourcePicUrl = async({ musicInfos, onToggleSource, isRefresh, retryedSource = [] }: {
  musicInfos: LX.Music.MusicInfoOnline[]
  onToggleSource: (musicInfo?: LX.Music.MusicInfoOnline) => void
  isRefresh: boolean
  retryedSource?: LX.OnlineSource[]
}): Promise<{
  url: string
  musicInfo: LX.Music.MusicInfoOnline
  isFromCache: boolean
}> => {
  let musicInfo: LX.Music.MusicInfoOnline | null = null
  // eslint-disable-next-line no-cond-assign
  while (musicInfo = (musicInfos.shift()!)) {
    if (retryedSource.includes(musicInfo.source)) continue
    retryedSource.push(musicInfo.source)
    // if (!assertApiSupport(musicInfo.source)) continue
    console.log('try toggle to: ', musicInfo.source, musicInfo.name, musicInfo.singer, musicInfo.interval)
    onToggleSource(musicInfo)
    break
  }
  if (!musicInfo) throw new Error(window.i18n.t('toggle_source_failed'))

  if (musicInfo.meta.picUrl && !isRefresh) return { musicInfo, url: musicInfo.meta.picUrl, isFromCache: true }

  let reqPromise
  try {
    reqPromise = musicSdk[musicInfo.source].getPic(toOldMusicInfo(musicInfo))
  } catch (err: any) {
    reqPromise = Promise.reject(err)
  }
  // retryedSource.includes(musicInfo.source)
  return reqPromise.then((url: string) => {
    return { musicInfo, url, isFromCache: false }
    // eslint-disable-next-line @typescript-eslint/promise-function-async
  }).catch((err: any) => {
    console.log(err)
    return getOnlineOtherSourcePicUrl({ musicInfos, onToggleSource, isRefresh, retryedSource })
  })
}

/**
 * 获取在线歌曲封面
 */
export const handleGetOnlinePicUrl = async({ musicInfo, isRefresh, onToggleSource, allowToggleSource }: {
  musicInfo: LX.Music.MusicInfoOnline
  onToggleSource: (musicInfo?: LX.Music.MusicInfoOnline) => void
  isRefresh: boolean
  allowToggleSource: boolean
}): Promise<{
  url: string
  musicInfo: LX.Music.MusicInfoOnline
  isFromCache: boolean
}> => {
  // console.log(musicInfo.source)
  let reqPromise
  try {
    reqPromise = musicSdk[musicInfo.source].getPic(toOldMusicInfo(musicInfo))
  } catch (err) {
    reqPromise = Promise.reject(err)
  }
  return reqPromise.then((url: string) => {
    return { musicInfo, url, isFromCache: false }
  }).catch(async(err: any) => {
    console.log(err)
    if (!allowToggleSource) throw err
    onToggleSource()
    // eslint-disable-next-line @typescript-eslint/promise-function-async
    return getOtherSource(musicInfo).then(otherSource => {
      console.log('find otherSource', otherSource)
      if (otherSource.length) {
        return getOnlineOtherSourcePicUrl({
          musicInfos: [...otherSource],
          onToggleSource,
          isRefresh,
          retryedSource: [musicInfo.source],
        })
      }
      throw err
    })
  })
}


export const getOnlineOtherSourceLyricInfo = async({ musicInfos, onToggleSource, isRefresh, retryedSource = [] }: {
  musicInfos: LX.Music.MusicInfoOnline[]
  onToggleSource: (musicInfo?: LX.Music.MusicInfoOnline) => void
  isRefresh: boolean
  retryedSource?: LX.OnlineSource[]
}): Promise<{
  lyricInfo: LX.Music.LyricInfo | LX.Player.LyricInfo
  musicInfo: LX.Music.MusicInfoOnline
  isFromCache: boolean
}> => {
  let musicInfo: LX.Music.MusicInfoOnline | null = null
  // eslint-disable-next-line no-cond-assign
  while (musicInfo = (musicInfos.shift()!)) {
    if (retryedSource.includes(musicInfo.source)) continue
    retryedSource.push(musicInfo.source)
    // if (!assertApiSupport(musicInfo.source)) continue
    console.log('try toggle to: ', musicInfo.source, musicInfo.name, musicInfo.singer, musicInfo.interval)
    onToggleSource(musicInfo)
    break
  }
  if (!musicInfo) throw new Error(window.i18n.t('toggle_source_failed'))

  if (!isRefresh) {
    const lyricInfo = await getCachedLyricInfo(musicInfo)
    if (lyricInfo) return { musicInfo, lyricInfo, isFromCache: true }
  }

  let reqPromise
  try {
    // TODO: remove any type
    reqPromise = (musicSdk[musicInfo.source].getLyric(toOldMusicInfo(musicInfo)) as any).promise
  } catch (err: any) {
    reqPromise = Promise.reject(err)
  }
  // retryedSource.includes(musicInfo.source)
  // eslint-disable-next-line @typescript-eslint/promise-function-async
  return reqPromise.then((lyricInfo: LX.Music.LyricInfo) => {
    return existTimeExp.test(lyricInfo.lyric) ? {
      lyricInfo,
      musicInfo,
      isFromCache: false,
    } : Promise.reject(new Error('failed'))
    // eslint-disable-next-line @typescript-eslint/promise-function-async
  }).catch((err: any) => {
    console.log(err)
    return getOnlineOtherSourceLyricInfo({ musicInfos, onToggleSource, isRefresh, retryedSource })
  })
}

/**
 * 获取在线歌词信息
 */
export const handleGetOnlineLyricInfo = async({ musicInfo, onToggleSource, isRefresh, allowToggleSource }: {
  musicInfo: LX.Music.MusicInfoOnline
  onToggleSource: (musicInfo?: LX.Music.MusicInfoOnline) => void
  isRefresh: boolean
  allowToggleSource: boolean
}): Promise<{
  musicInfo: LX.Music.MusicInfoOnline
  lyricInfo: LX.Music.LyricInfo | LX.Player.LyricInfo
  isFromCache: boolean
}> => {
  // console.log(musicInfo.source)
  let reqPromise
  try {
    // TODO: remove any type
    reqPromise = (musicSdk[musicInfo.source].getLyric(toOldMusicInfo(musicInfo)) as any).promise
  } catch (err) {
    reqPromise = Promise.reject(err)
  }
  // eslint-disable-next-line @typescript-eslint/promise-function-async
  return reqPromise.then((lyricInfo: LX.Music.LyricInfo) => {
    return existTimeExp.test(lyricInfo.lyric) ? {
      musicInfo,
      lyricInfo,
      isFromCache: false,
    } : Promise.reject(new Error('failed'))
  }).catch(async(err: any) => {
    console.log(err)
    if (!allowToggleSource) throw err

    onToggleSource()
    // eslint-disable-next-line @typescript-eslint/promise-function-async
    return getOtherSource(musicInfo).then(otherSource => {
      console.log('find otherSource', otherSource)
      if (otherSource.length) {
        return getOnlineOtherSourceLyricInfo({
          musicInfos: [...otherSource],
          onToggleSource,
          isRefresh,
          retryedSource: [musicInfo.source],
        })
      }
      throw err
    })
  })
}
