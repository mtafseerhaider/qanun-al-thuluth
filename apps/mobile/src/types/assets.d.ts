// Metro resolves bundled assets to numeric module ids.
declare module '*.ttf' {
  const asset: number;
  export default asset;
}
declare module '*.png' {
  const asset: number;
  export default asset;
}
