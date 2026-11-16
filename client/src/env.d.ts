/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** UUID du site Umami. Absent au build : le script de mesure n'est pas chargé. */
  readonly VITE_UMAMI_WEBSITE_ID?: string;
}
