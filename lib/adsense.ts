const configured = process.env.NEXT_PUBLIC_ADSENSE_CLIENT_ID?.trim();
export const ADSENSE_CLIENT_ID = configured?.startsWith("ca-pub-") ? configured : "ca-pub-5840946362532267";
export const ADSENSE_PUBLISHER_ID = ADSENSE_CLIENT_ID.slice("ca-".length);
