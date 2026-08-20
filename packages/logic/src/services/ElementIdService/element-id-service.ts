import { type ElementIdServiceInterface } from "./element-id-service-interface";

class ElementIdServiceImpl implements ElementIdServiceInterface {
    private elementIdMap = new Map<string, { count: number }>();

    public generateElementId(prefix = "fkui"): string {
        const id = this.nextId(prefix);
        /* Deliberately only checks `document` here, never reaches into a
         * shadow root (our own or - especially - anyone else's). Two
         * separate web components (e.g. different major versions of this
         * library) may in theory end up generating the same id for an
         * element inside their own respective shadow roots; that is
         * harmless since nothing in this library ever looks up an element
         * by id across a shadow boundary, so such a collision can never
         * cause one component to affect another. */
        if (document.querySelector(`#${id}`) === null) {
            return id;
        }
        return this.generateElementId(prefix);
    }

    private nextId(prefix: string): string {
        let elementIdWithPadding = String(this.getIdFromMap(prefix));
        while (elementIdWithPadding.length < 4) {
            elementIdWithPadding = `0${elementIdWithPadding}`;
        }
        return `${prefix}-vue-element-${elementIdWithPadding}`;
    }

    private getIdFromMap(prefix: string): number {
        const elementId = this.elementIdMap.get(prefix);

        if (!elementId) {
            this.elementIdMap.set(prefix, { count: 1 });
            return 1;
        }
        elementId.count++;
        return elementId.count;
    }

    public reset(): void {
        this.elementIdMap = new Map();
    }
}

/**
 * @public
 */
export const ElementIdService: ElementIdServiceInterface =
    /* @__PURE__ */
    new ElementIdServiceImpl();
