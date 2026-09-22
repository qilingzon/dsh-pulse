/* dsh-pulse · host half
 *
 * 这是一枚纯客户端 UI 插件：全部行为在 client.js（往 conversation.composer.dock
 * 加一枚两位小数的「缓存命中」读数）。宿主半部不注入提示词、不注册服务、不落盘，
 * 只提供一个可挂载的 Cordis 插件对象，让 bundle 行能在 profile 组合中真正激活。
 *
 * 之所以仍要有宿主半部：package.json 的 main 指向本文件，profile bundles 里的一行
 * 需要一个能 apply 的宿主入口；空实现即最小合规形态（不占服务名，不与别的行撞车）。
 */
export const name = "dsh-pulse";
export const inject = [];

export function apply() {
  // 故意为空：本插件没有宿主侧贡献（A27 交付轴：只碰显示层）。
}
