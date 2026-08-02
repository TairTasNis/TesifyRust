export const fetchSpotifyData = async (url: string) => {
    try {
        const response = await fetch(`http://127.0.0.1:8000/api/spotify?url=${encodeURIComponent(url)}`);
        if (!response.ok) {
            throw new Error("Ошибка импорта Spotify: " + response.statusText);
        }
        
        const data = await response.json();
        return data.tracks;
    } catch (e: any) {
        throw new Error(e.message || "Ошибка импорта Spotify. Убедитесь, что ссылка рабочая: " + url);
    }
};
