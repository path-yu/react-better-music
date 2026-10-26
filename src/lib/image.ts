const CDN_IMAGE_HOST = /^https?:\/\/[^/]*music\.126\.net\//i

/**
 * NetEase's image CDN accepts `param=WxH` to resize/crop on the fly. Lists and
 * cards render covers far smaller than the original file, so ask for the
 * displayed size instead of downloading a multi-megapixel JPEG.
 */
export function resizedImageUrl(src: string | null | undefined, size?: string) {
  if (!src) return src
  if (!CDN_IMAGE_HOST.test(src)) return src
  // The CDN occasionally returns http URLs, which a secure page rejects.
  const secure = src.replace(/^http:\/\//i, 'https://')
  if (!size) return secure
  if (/[?&]param=/.test(secure)) return secure
  return `${secure}${secure.includes('?') ? '&' : '?'}param=${size}`
}

export function getImageSize(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.onload = () => {
      const image = new Image()
      image.onerror = () => reject(new Error('图片解析失败'))
      image.onload = () => resolve({ width: image.width, height: image.height })
      image.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  })
}
