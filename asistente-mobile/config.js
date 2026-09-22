import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@server_url';
const DEFAULT_URL = 'http://192.168.0.11:3000/api';

/**
 * Obtiene la URL del servidor guardada, o retorna la URL por defecto.
 */
export async function getServerUrl() {
  try {
    const url = await AsyncStorage.getItem(STORAGE_KEY);
    return url || DEFAULT_URL;
  } catch {
    return DEFAULT_URL;
  }
}

/**
 * Guarda una nueva URL del servidor.
 * @param {string} url - La URL completa del API (ej: http://192.168.0.5:3000/api)
 */
export async function setServerUrl(url) {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, url.trim());
    return true;
  } catch {
    return false;
  }
}

/**
 * Construye la URL del servidor a partir de solo la IP.
 * @param {string} ip - Solo la IP (ej: 192.168.0.5)
 */
export function buildApiUrl(ip) {
  return `http://${ip.trim()}:3000/api`;
}

export { DEFAULT_URL };
