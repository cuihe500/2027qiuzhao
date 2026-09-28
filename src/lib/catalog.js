export const DIRECTIONS = [
  ['AI产品', ['AI产品', 'AIGC产品', 'AI应用产品', 'AI技术产品', '人工智能产品', '大模型产品']],
  ['产品经理', ['产品经理', 'PM', '产品岗', '产品类', '产品方向', '产品策划', '中后台产品', '商业化产品']],
  ['产品运营', ['产品运营']],
  ['运营', ['运营', '用户增长', '内容运营', '用户运营', '活动运营']],
  ['市场/品牌', ['市场', '营销', '品牌', '公关', '广告']],
  ['销售/商务', ['销售', '商务', 'BD', '拓展']],
  ['游戏策划', ['游戏策划', '虚拟世界', '游戏方向', '制作人', '游戏行业']],
  ['电商/零售', ['电商', '零售', '门店', '新零售', '直播', '天猫', '京东自营']],
  ['数据/分析', ['数据分析', '商业分析', '经营分析', '策略', '数据产品', '用户研究']],
  ['供应链/物流', ['供应链', '物流', '仓储', '采购', '配送']],
  ['管培/综合', ['管培', '管理培训生', '综合管理', '项目管理', '职能']],
  ['研发/技术', ['研发', '算法', '开发', '技术', '工程']],
]

export function searchText(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/[\s（）()·._-]+/g, '')
}

export function splitTerms(value) {
  return String(value).split(/[\s,，、;；|｜]+/).map(searchText).filter(Boolean)
}

export function linkParts(value) {
  const text = String(value || '')
  const pattern = /https?:\/\/[^\s"'<>（）()\[\]｜|;；，,、。]+|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
  const parts = []
  let previous = 0
  for (const match of text.matchAll(pattern)) {
    if (match.index > previous) parts.push({ text: text.slice(previous, match.index) })
    parts.push({ text: match[0], href: match[0].includes('://') ? match[0] : `mailto:${match[0]}` })
    previous = match.index + match[0].length
  }
  if (previous < text.length) parts.push({ text: text.slice(previous) })
  return parts
}

export function downloadFile(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function csvCell(value) {
  const text = String(value ?? '')
  const safe = /^[\s]*[=+@-]/.test(text) ? `'${text}` : text
  return `"${safe.replace(/"/g, '""')}"`
}
