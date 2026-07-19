import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import type { Scene } from "@babylonjs/core/scene";

/**
 * 3D 결과용 최소 정점색 재질.
 *
 * 결과 메시에는 법선/텍스처가 없으므로 StandardMaterial의 조명·텍스처 셰이더군을
 * 포함할 필요가 없다. 정점색과 투명도만 처리해 WebView 초기 번들을 작게 유지한다.
 */
export function createVertexColorMaterial(
    name: string,
    scene: Scene,
    opacity = 1,
): ShaderMaterial {
    const material = new ShaderMaterial(
        name,
        scene,
        {
            vertexSource: `
                precision highp float;
                attribute vec3 position;
                attribute vec4 color;
                uniform mat4 worldViewProjection;
                varying vec4 vColor;

                void main(void) {
                    gl_Position = worldViewProjection * vec4(position, 1.0);
                    vColor = color;
                }
            `,
            fragmentSource: `
                precision highp float;
                varying vec4 vColor;
                uniform float opacity;

                void main(void) {
                    gl_FragColor = vec4(vColor.rgb, vColor.a * opacity);
                }
            `,
        },
        {
            attributes: ["position", "color"],
            uniforms: ["worldViewProjection", "opacity"],
            needAlphaBlending: opacity < 1,
        },
    );

    material.backFaceCulling = false;
    material.setFloat("opacity", opacity);
    return material;
}
