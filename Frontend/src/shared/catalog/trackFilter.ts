function normalize(value: string) {
  return value.normalize('NFKC').toLowerCase()
}

export function trackFilter(query: string) {
  const terms = normalize(query.trim()).split(/\s+/).filter(Boolean)
  return (title: string, artists: string) => {
    const text = normalize(`${title} ${artists}`)
    return terms.every(term => text.includes(term))
  }
}
