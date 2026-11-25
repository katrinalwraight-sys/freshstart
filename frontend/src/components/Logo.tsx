import { Image } from "expo-image";
import React from "react";

// Fresh Start brand logo (pomegranate). `full` includes the wordmark.
export function Logo({ size = 44, full, testID }: { size?: number; full?: boolean; testID?: string }) {
  return (
    <Image
      testID={testID}
      source={full ? require("../../assets/images/logo-full.png") : require("../../assets/images/logo-mark.png")}
      style={{ width: size, height: size, borderRadius: full ? 16 : size / 4 }}
      contentFit="contain"
    />
  );
}
