"use client";

import dynamic from "next/dynamic";

/** Loads three.js and the orb only in the browser, after the page is interactive. */
const OrbLazy = dynamic(() => import("./Orb"), { ssr: false });
export default OrbLazy;
