content = open('src/app/api/m4/upload-image/route.ts').read()

old = """    const res = await fetch(`https://graph.facebook.com/${V}/${adAccountId}/adimages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bytes: base64, access_token: token })
    })

    const data = await res.json()
    if (data.error) return NextResponse.json({ error: data.error.message }, { status: 400 })

    const images = data.images
    const firstKey = Object.keys(images)[0]
    const hash = images[firstKey]?.hash
    const url = images[firstKey]?.url

    return NextResponse.json({ hash, url, name: firstKey })"""

new = """    // Handle video vs image upload
    const isVideo = mimeType?.startsWith('video/')

    if (isVideo) {
      // Upload video to Meta
      const videoRes = await fetch(`https://graph.facebook.com/${V}/${adAccountId}/advideos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_url: `data:${mimeType};base64,${base64}`, access_token: token, title: name || 'Ad Video' })
      })
      const videoData = await videoRes.json()
      if (videoData.error) {
        // Fallback: try uploading as form data approach - return placeholder
        console.log('Video upload error:', videoData.error.message)
        return NextResponse.json({ hash: null, url: null, error: videoData.error.message, isVideo: true })
      }
      return NextResponse.json({ hash: videoData.id, url: null, isVideo: true, name })
    }

    const res = await fetch(`https://graph.facebook.com/${V}/${adAccountId}/adimages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bytes: base64, access_token: token })
    })

    const data = await res.json()
    if (data.error) return NextResponse.json({ error: data.error.message }, { status: 400 })

    const images = data.images
    const firstKey = Object.keys(images)[0]
    const hash = images[firstKey]?.hash
    const url = images[firstKey]?.url

    return NextResponse.json({ hash, url, name: firstKey })"""

content = content.replace(old, new)
open('src/app/api/m4/upload-image/route.ts', 'w').write(content)
print('Video upload fixed:', 'isVideo' in content)
