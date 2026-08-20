import { describe, expect, it } from "vitest";
import { ElementIdService } from "./element-id-service";

describe("generateElementId", () => {
    it("should generate element id with increment of 1 each call", () => {
        expect.assertions(2);
        const firstElementId = ElementIdService.generateElementId();
        const secondElementId = ElementIdService.generateElementId();

        expect(firstElementId).toBe("fkui-vue-element-0001");
        expect(secondElementId).toBe("fkui-vue-element-0002");
    });

    it("should generate element id with increment of 1 each call XXXX", () => {
        expect.assertions(2);
        document.body.innerHTML = /* HTML */ `
            <div id="fkui-vue-element-0001"></div>
            <div id="fkui-vue-element-0002"></div>
            <div id="fkui-vue-element-0004"></div>
        `;

        const firstElementId = ElementIdService.generateElementId();
        const secondElementId = ElementIdService.generateElementId();

        expect(firstElementId).toBe("fkui-vue-element-0003");
        expect(secondElementId).toBe("fkui-vue-element-0005");
        ElementIdService.reset();
    });

    it("should generate element id with increment of 1 each call XXXX with support for specific prefix", () => {
        expect.assertions(3);
        document.body.innerHTML = /* HTML */ `
            <div id="fkui-vue-element-0001"></div>
            <div id="fkui-vue-element-0002"></div>
            <div id="fkui-vue-element-0004"></div>
            <div id="foobar-vue-element-0001"></div>
            <div id="foobar-vue-element-0003"></div>
        `;

        const firstElementId = ElementIdService.generateElementId();
        const secondElementId = ElementIdService.generateElementId("foobar");
        const thirdElementId = ElementIdService.generateElementId("foobar");

        expect(firstElementId).toBe("fkui-vue-element-0003");
        expect(secondElementId).toBe("foobar-vue-element-0002");
        expect(thirdElementId).toBe("foobar-vue-element-0004");

        ElementIdService.reset();
    });

    it("should not consider ids used inside a shadow root as taken (never reaches across a shadow boundary)", () => {
        expect.assertions(1);
        ElementIdService.reset();
        document.body.replaceChildren();
        const host = document.createElement("div");
        document.body.append(host);
        const shadowRoot = host.attachShadow({ mode: "open" });
        shadowRoot.innerHTML = /* HTML */ `
            <div id="fkui-vue-element-0001"></div>
        `;

        const generatedId = ElementIdService.generateElementId();

        expect(generatedId).toBe("fkui-vue-element-0001");

        document.body.replaceChildren();
        ElementIdService.reset();
    });
});
