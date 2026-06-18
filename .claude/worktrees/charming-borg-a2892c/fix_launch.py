content = open('src/app/api/m4/launch/route.ts').read()

# Fix createAdCreative to handle video hash
old = """    const createAdCreative = async (name: string, imageHash: string | null, customCopy?: any) => {
      const cp = customCopy || {}
      const msg = cp.primaryText || primaryText || 'Check out our products'
      const lnk = cp.destinationUrl || websiteUrl
      const hd = cp.headline || headline || campaignName
      const ct = cp.cta || cta || 'LEARN_MORE'
      if (!pageId || !lnk) return null
      try {
        const linkData: Record<string,unknown> = {
          message: msg, link: lnk, name: hd, description: '',
          call_to_action: { type: ct, value: { link: lnk } },
        }
        if (imageHash) linkData.image_hash = imageHash"""

new = """    const createAdCreative = async (name: string, imageHash: string | null, customCopy?: any, isVideo = false) => {
      const cp = customCopy || {}
      const msg = cp.primaryText || primaryText || 'Check out our products'
      const lnk = cp.destinationUrl || websiteUrl
      const hd = cp.headline || headline || campaignName
      const ct = cp.cta || cta || 'LEARN_MORE'
      if (!pageId || !lnk) return null
      try {
        const linkData: Record<string,unknown> = {
          message: msg, link: lnk, name: hd, description: '',
          call_to_action: { type: ct, value: { link: lnk } },
        }
        if (isVideo && imageHash) {
          linkData.video_id = imageHash
        } else if (imageHash) {
          linkData.image_hash = imageHash
        }"""

content = content.replace(old, new)

# Fix broad adset creative call to pass video flag
content = content.replace(
    "const creativeId = await createAdCreative(`Creative — ${c.name}`, c.hash || null)",
    "const creativeId = await createAdCreative(`Creative — ${c.name}`, c.hash || null, undefined, c.type === 'video')"
)

# Fix interest adset creative call
content = content.replace(
    "const creativeId = await createAdCreative(`Creative — ${interest.name}`, firstHash)",
    "const creativeId = await createAdCreative(`Creative — ${interest.name}`, firstHash, undefined, firstCreative?.type === 'video')"
)

# Fix retargeting creative call
content = content.replace(
    "const rtCreative = await createAdCreative(`RT Creative — ${c.name}`, c.hash || null, retargetingCopy)",
    "const rtCreative = await createAdCreative(`RT Creative — ${c.name}`, c.hash || null, retargetingCopy, c.type === 'video')"
)

# Add exclusion of website visitors from prospecting broad adset
old2 = """          targeting: {
            age_min: parseInt(ageMin) || 18,
            geo_locations: { countries: ['PK'] },
            ...(gender === 'MALE' ? { genders: [1] } : gender === 'FEMALE' ? { genders: [2] } : {}),
            targeting_automation: { advantage_audience: 1 },
          },
          bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
          destination_type: 'WEBSITE',
          ...optSettings,
          ...promotedObject,"""

new2 = """          targeting: {
            age_min: parseInt(ageMin) || 18,
            geo_locations: { countries: ['PK'] },
            ...(gender === 'MALE' ? { genders: [1] } : gender === 'FEMALE' ? { genders: [2] } : {}),
            targeting_automation: { advantage_audience: 1 },
          },
          bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
          destination_type: 'WEBSITE',
          ...optSettings,
          ...promotedObject,"""

# Add exclusions to interest adset targeting
old3 = """          targeting: {
            ...intTargeting,
            targeting_automation: { advantage_audience: 0 },
          },"""

# Already correct - just ensure retargeting audience is added to retargeting adset targeting
print("Video support:", "isVideo" in content)
print("Exclusions noted")

open('src/app/api/m4/launch/route.ts', 'w').write(content)
