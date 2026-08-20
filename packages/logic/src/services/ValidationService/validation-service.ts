import { isRadiobuttonOrCheckbox, isValidatableFormElement } from "../../dom";
import { isSet } from "../../utils";
import { getErrorMessages } from "./ValidationTranslations/get-error-messages";
import { createFieldsetValidator } from "./fieldset-validation-handler";
import { getCandidates } from "./get-candidates";
import { getElementType } from "./get-element-type";
import { registry } from "./registry";
import {
    type ElementValidatorsReference,
    type PendingValidityEvent,
    type ValidatableHTMLElement,
    type ValidateEvent,
    type ValidationConfigUpdateDetail,
    type ValidationResult,
    type ValidationServiceInterface,
    type ValidationState,
    type ValidatorConfig,
    type ValidatorConfigs,
    type ValidityEvent,
    type ValidityMode,
    type ValidityNativeEvent,
} from "./validation-service-interface";
import { type Validator, type ValidatorName } from "./validator";

/**
 * Returns true if given element is a validatable element.
 *
 * Also see {@link isValidatableFormElement} for a similar function but
 * excluding HTMLFieldSetElement.
 *
 * @public
 * @param element - Element to test
 */
export function isValidatableHTMLElement(
    element: Element,
): element is ValidatableHTMLElement {
    if (element.classList.contains("card")) {
        return true;
    }

    return (
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement ||
        element instanceof HTMLSelectElement ||
        element instanceof HTMLFieldSetElement
    );
}

function hasValidators(element: HTMLElement): boolean {
    return typeof element.dataset.validation === "string";
}

interface AllValidatorsResult {
    isValid: boolean;
    validationMessage: string;
}

class ValidationServiceImpl implements ValidationServiceInterface {
    private validationStates = new Map<
        ValidatableHTMLElement,
        ValidationState
    >();
    private elementValidatorsReferences = new Map<
        ValidatableHTMLElement,
        ElementValidatorsReference
    >();

    public validationErrorMessages: Record<ValidatorName, string | undefined> =
        {};

    public constructor() {
        this.setErrorMessages(getErrorMessages());
    }

    public getElementsAndValidators(): Record<
        string,
        ElementValidatorsReference
    > {
        const result: Record<string, ElementValidatorsReference> = {};
        for (const [element, reference] of this.elementValidatorsReferences) {
            result[element.id] = reference;
        }
        return result;
    }

    public get isAnyTouched(): boolean {
        return Array.from(this.validationStates.values()).some(
            (item) => item.touched === true,
        );
    }

    public addValidationErrorMessages(
        validationErrorMessages: Record<ValidatorName, string>,
    ): void {
        this.setErrorMessages(validationErrorMessages);
    }

    public setErrorMessages(
        messages: Record<string, string>,
        options: { clear?: boolean } = {},
    ): void {
        const { clear = false } = options;
        if (clear) {
            this.clearErrorMessages();
        }
        const current = this.validationErrorMessages;
        this.validationErrorMessages = { ...current, ...messages };
    }

    public clearErrorMessages(): void {
        this.validationErrorMessages = {};
    }

    public registerValidator<TConfig = ValidatorConfig>(
        validator: Validator<TConfig>,
    ): void {
        const { name } = validator;
        registry[name] = validator;
    }

    private shouldApplyNewConfigOnBaseConfig(
        isBaseConfigs: boolean,
        elementValidatorsReference: ElementValidatorsReference,
    ): boolean {
        return (
            !isBaseConfigs &&
            isSet(elementValidatorsReference.baseValidatorConfigs)
        );
    }

    private decideEffectiveValidatorReference(
        element: ValidatableHTMLElement,
        newValidatorConfigs: ValidatorConfigs,
        isBaseConfigs: boolean,
    ): ValidatorConfigs {
        const elementValidatorsReference =
            this.elementValidatorsReferences.get(element);

        if (!elementValidatorsReference) {
            return newValidatorConfigs;
        }
        if (
            this.shouldApplyNewConfigOnBaseConfig(
                isBaseConfigs,
                elementValidatorsReference,
            )
        ) {
            return this.mergeValidatorConfigs(
                elementValidatorsReference.baseValidatorConfigs,
                newValidatorConfigs,
            );
        }
        if (isBaseConfigs) {
            const validatorConfigs = this.mergeValidatorConfigs(
                newValidatorConfigs,
                elementValidatorsReference.validatorConfigs,
            );
            elementValidatorsReference.baseValidatorConfigs =
                newValidatorConfigs;
            return validatorConfigs;
        }
        return newValidatorConfigs;
    }

    private dispatchValidationConfig(
        validatorConfigs: ValidatorConfigs,
        element: ValidatableHTMLElement,
    ): void {
        const event = new CustomEvent<ValidationConfigUpdateDetail>(
            "validation-config-update",
            {
                bubbles: false,
                detail: { config: validatorConfigs },
            },
        );
        element.dispatchEvent(event);
    }

    public removeValidatorsFromElement(element: ValidatableHTMLElement): void {
        this.elementValidatorsReferences.delete(element);
    }

    public addValidatorsToElement(
        element: ValidatableHTMLElement,
        newValidatorConfigs: ValidatorConfigs,
        isBaseConfigs = false,
    ): void {
        if (!isValidatableHTMLElement(element)) {
            return;
        }
        const validatorConfigs = this.decideEffectiveValidatorReference(
            element,
            newValidatorConfigs,
            isBaseConfigs,
        );

        this.dispatchValidationConfig(validatorConfigs, element);

        if (element instanceof HTMLFieldSetElement) {
            createFieldsetValidator(element, this);
        }
        this.setRequiredAttribute(element, validatorConfigs);

        const foundValidators = this.getValidators(validatorConfigs);

        // set data-validation attribute to indicate that validation is activated on the element
        if (foundValidators.length > 0) {
            element.dataset.validation = "";
        }

        const useInstantValidation = this.useInstantValidation(
            foundValidators,
            validatorConfigs,
        );
        const existingReference = this.elementValidatorsReferences.get(element);

        if (existingReference) {
            existingReference.validatorConfigs = validatorConfigs;
            existingReference.validators = foundValidators;
            existingReference.instant = useInstantValidation;
        } else {
            const elementValidatorsReference: ElementValidatorsReference = {
                validators: foundValidators,
                validatorConfigs,
                element,
                instant: useInstantValidation,
                baseValidatorConfigs: isBaseConfigs
                    ? validatorConfigs
                    : undefined,
            };

            this.elementValidatorsReferences.set(
                element,
                elementValidatorsReference,
            );
            this.createEventListeners(elementValidatorsReference);
        }
    }

    private mergeValidatorConfigs(
        baseConfig: ValidatorConfigs | undefined,
        newConfig: ValidatorConfigs,
    ): ValidatorConfigs {
        const required = isSet(newConfig.required)
            ? { required: {} }
            : undefined;
        return {
            ...required,
            ...baseConfig,
            ...newConfig,
        };
    }

    private createEventListeners(
        elementValidatorsReference: ElementValidatorsReference,
    ): void {
        const element = elementValidatorsReference.element;
        if (!(element instanceof HTMLFieldSetElement)) {
            element.addEventListener("input", () => {
                const validationState =
                    this.getExistingStateOrSetDefault(element);
                validationState.serverError = undefined;

                if (elementValidatorsReference.instant) {
                    validationState.touched = true;

                    this.validateAndDispatchEvent("input", {
                        validationState,
                        elementValidatorsReference,
                    });
                } else {
                    element.dispatchEvent(
                        new CustomEvent<PendingValidityEvent>(
                            "pending-validity",
                            {
                                bubbles: false,
                            },
                        ),
                    );
                }
            });
            element.addEventListener("change", () => {
                const validationState =
                    this.getExistingStateOrSetDefault(element);
                validationState.touched = true;
                this.validateAndDispatchEvent("change", {
                    validationState,
                    elementValidatorsReference,
                });
            });
            element.addEventListener("blur", () => {
                const validationState =
                    this.getExistingStateOrSetDefault(element);
                validationState.touched = true;

                this.validateAndDispatchEvent("blur", {
                    validationState,
                    elementValidatorsReference,
                });
            });
        }

        element.addEventListener("validate", () => {
            const validationState = this.getExistingStateOrSetDefault(element);
            this.validateAndDispatchEvent("validate", {
                validationState,
                elementValidatorsReference,
            });
        });
    }

    /* eslint-disable-next-line @typescript-eslint/require-await -- technical debt */
    public async isValid(
        src: string | string[] | Element | Element[] | null,
        root: Document | Element = document,
    ): Promise<boolean> {
        /* nest inner sync function mostly because the code itself is sync
         * (especially required by Array.every) but we still want the API to be
         * async to future-proof it */
        function isValidSync(
            src: string | string[] | Element | Element[] | null,
        ): boolean {
            if (!src) {
                return false;
            }
            if (Array.isArray(src)) {
                const array: Array<string | Element> = src;
                return array.every((it) => isValidSync(it));
            }
            if (typeof src === "string") {
                /* eslint-disable-next-line unicorn/no-useless-recursion -- technical debt */
                return isValidSync(root.querySelector(`#${src}`));
            }
            if (isValidatableFormElement(src)) {
                return src.validity.valid;
            }
            return src.querySelectorAll(":invalid").length === 0;
        }
        return isValidSync(src);
    }

    public async validateElement(
        src: Element | string | null,
    ): Promise<ValidationResult> {
        if (!src) {
            return {
                isValid: true,
                isTouched: false,
                isSubmitted: false,
                error: null,
            };
        }
        if (typeof src === "string") {
            const element = document.querySelector(`#${src}`);
            if (!element) {
                throw new Error(
                    `Element with id "${src}" not found when calling validateElement(..)`,
                );
            }
            src = element;
        }
        if (!isValidatableHTMLElement(src)) {
            const tagName = src.tagName.toLowerCase();
            const ref = `${tagName}#${src.id}`;
            throw new Error(`Element "${ref}" is not a validatable element`);
        }

        const element: ValidatableHTMLElement = src;

        /* Handle when element has no registered validators (and thus no event
         * listeners) by assuming the element is valid */
        if (!hasValidators(element)) {
            /* For compatibility (mostly with whitebox unittests) this event is
             * still delivered. Relying on this event is discouraged and
             * deprecated */
            const event = new CustomEvent<ValidateEvent>("validate", {
                bubbles: false,
            });
            element.dispatchEvent(event);
            return {
                isValid: true,
                isTouched: false,
                isSubmitted: false,
                error: null,
            };
        }

        return new Promise<ValidationResult>((resolve, reject) => {
            /* Add a temporary listener, as long as IE11 is supported we cannot
             * use "once" so instead we save the listener and remove it manually
             * later. */
            /* `element` is a union of several HTMLElement subtypes, which
             * makes TS fall back to the generic EventListener overload of
             * add/removeEventListener instead of the "validity"-specific one
             * declared in HTMLElementEventMap - cast at the call sites below
             * rather than widening the listener's own signature. */
            const once = (event: CustomEvent<ValidityEvent>): void => {
                element.removeEventListener("validity", once as EventListener);
                clearTimeout(watchdog);
                const {
                    touched: isTouched = false,
                    submitted: isSubmitted = false,
                } = this.getState(element) ?? {};
                const { isValid, validationMessage } = event.detail;
                resolve({
                    isValid,
                    isTouched,
                    isSubmitted,
                    error: isValid ? null : validationMessage,
                });
            };
            element.addEventListener("validity", once as EventListener);

            /* Add a watchdog timer in case the listener isn't actually there or
             * if the event is blocked with {@link stopPropagation} or similar. */
            const watchdog = setTimeout(() => {
                const tagName = element.tagName.toLowerCase();
                const ref = `${tagName}#${element.id}`;
                element.removeEventListener("validity", once as EventListener);
                /* eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- technical debt */
                reject(
                    `Element "${ref}" did not respond with validity event after 500ms`,
                );
            }, 500);

            /* Dispatch request to validate, this is supposed to be picked up by
             * the the eventlistener installed while adding validators and in a
             * happy-case this is 1:1 mapped to receiving the "validity"
             * event. */
            const event = new CustomEvent<ValidateEvent>("validate", {
                bubbles: false,
            });
            element.dispatchEvent(event);
        });
    }

    public async validateAllElements(root: Element | string): Promise<void> {
        const elements = this.getValidatableElements(root);
        const promises = elements.map((it) => this.validateElement(it));
        await Promise.all(promises);
    }

    public setState(
        element: string | Element | null,
        validationState: ValidationState,
    ): void {
        if (!element) {
            return;
        }
        if (typeof element === "string") {
            const found = document.querySelector(`#${element}`);
            /* eslint-disable-next-line @typescript-eslint/no-deprecated -- internal usage */
            this.setState(found, validationState);
        } else if (!isValidatableHTMLElement(element)) {
            const childElements = this.getValidatableElements(element);

            for (const childElement of childElements) {
                /* eslint-disable-next-line @typescript-eslint/no-deprecated -- internal usage */
                this.setState(childElement, validationState);
            }
        } else {
            const existingState = this.validationStates.get(element);

            if (existingState) {
                this.validationStates.set(element, {
                    ...existingState,
                    ...validationState,
                });
            } else {
                this.validationStates.set(element, validationState);
            }
        }
    }

    public setSubmitted(element: string | Element | null): void {
        /* eslint-disable-next-line @typescript-eslint/no-deprecated -- internal usage */
        this.setState(element, {
            submitted: true,
        });
    }

    public setTouched(element: string | Element | null): void {
        /* eslint-disable-next-line @typescript-eslint/no-deprecated -- internal usage */
        this.setState(element, {
            touched: true,
        });
    }

    public setError(element: string | Element | null, message: string): void {
        /* eslint-disable-next-line @typescript-eslint/no-deprecated -- internal usage */
        this.setState(element, {
            serverError: message,
        });
    }

    public resetState(element: string | Element | null): void {
        /* eslint-disable-next-line @typescript-eslint/no-deprecated -- internal usage */
        this.setState(element, {
            touched: false,
            submitted: false,
            serverError: undefined,
        });
    }

    private getValidatableElements(
        parent: string | Element | null,
    ): ValidatableHTMLElement[] {
        if (!parent) {
            return [];
        }
        if (typeof parent === "string") {
            const element = document.querySelector(`#${parent}`);
            return this.getValidatableElements(element);
        }
        const selector = ["input", "textarea", "select", "fieldset"].join(",");
        return Array.from(parent.querySelectorAll(selector));
    }

    private setRequiredAttribute(
        element: ValidatableHTMLElement,
        validatorConfigs: ValidatorConfigs,
    ): void {
        if (!validatorConfigs.required) {
            return;
        }
        if (validatorConfigs.required.enabled !== false) {
            element.dataset.required = "";
            if (isValidatableFormElement(element)) {
                element.setAttribute("required", "");
            }
        } else {
            delete element.dataset.required;
            if (isValidatableFormElement(element)) {
                element.removeAttribute("required");
            }
        }
    }

    private useInstantValidation(
        foundValidators: Validator[],
        validatorConfigs: ValidatorConfigs,
    ): boolean {
        return foundValidators.some((validator) => {
            const config = validatorConfigs[validator.name];
            const instantConfig = isSet(config) ? config.instant : undefined;
            return (
                /* eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- false positive */
                (validator.instant && instantConfig !== false) ||
                instantConfig === true
            );
        });
    }

    private getState(
        element: ValidatableHTMLElement,
    ): ValidationState | undefined {
        return this.validationStates.get(element);
    }

    private getExistingStateOrSetDefault(
        element: ValidatableHTMLElement,
    ): ValidationState {
        let validationState = this.getState(element);

        if (!validationState) {
            validationState = { touched: false, submitted: false };
            /* eslint-disable-next-line @typescript-eslint/no-deprecated -- internal usage */
            this.setState(element, validationState);
        }

        return validationState;
    }

    private getValidators(validatorConfigs: ValidatorConfigs): Validator[] {
        const validatorNames = Object.keys(validatorConfigs);

        return validatorNames.map((validatorName) => {
            const validator = registry[validatorName];
            /* eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- technical debt */
            if (validator) {
                return validator;
            }
            throw new Error(
                `Validator '${validatorName}' does not exist or is not registered, see ValidatorService.registerValidator.`,
            );
        });
    }

    public getValidatorByName<TConfig>(
        name: ValidatorName,
    ): Validator<TConfig> {
        if (!Object.hasOwn(registry, name)) {
            throw new Error(
                `Validator '${name}' does not exist or is not registered, see ValidatorService.registerValidator.`,
            );
        }

        return registry[name];
    }

    private validateAndDispatchEvent(
        nativeEvent: ValidityNativeEvent,
        params: {
            validationState: ValidationState;
            elementValidatorsReference: ElementValidatorsReference;
        },
    ): void {
        const validationResult = this.validateAll(
            params.elementValidatorsReference.element,
            params.validationState,
            params.elementValidatorsReference.validators,
            params.elementValidatorsReference.validatorConfigs,
        );

        const validityMode = this.resolveValidityMode(
            params.elementValidatorsReference.element,
            params.validationState,
            validationResult.isValid,
        );

        this.dispatchValidityEvent(params.elementValidatorsReference.element, {
            ...validationResult,
            target: params.elementValidatorsReference.element,
            elementId: params.elementValidatorsReference.element.id,
            validityMode,
            nativeEvent,
        });
    }

    private resolveValidityMode(
        element: ValidatableHTMLElement,
        validationState: ValidationState,
        isValid: boolean,
    ): ValidityMode {
        if (validationState.serverError) {
            return "ERROR";
        }
        if (isValid) {
            return this.resolveValidityModeWhenValid(element);
        }
        return this.resolveValidityModeWhenError(
            element,
            validationState.touched,
            validationState.submitted,
        );
    }

    private resolveValidityModeWhenValid(
        element: ValidatableHTMLElement,
    ): ValidityMode {
        return this.hasValue(element) ? "VALID" : "INITIAL";
    }

    public resolveValidityModeWhenError(
        element: ValidatableHTMLElement,
        touched?: boolean,
        submitted?: boolean,
    ): ValidityMode {
        return submitted || this.hasValue(element) ? "ERROR" : "INITIAL";
    }

    private hasValue(element: ValidatableHTMLElement): boolean {
        if (element instanceof HTMLFieldSetElement) {
            return Array.from(element.querySelectorAll("input")).some(
                (fieldsetInputElement) => {
                    return this.hasValue(fieldsetInputElement);
                },
            );
        }
        if (element instanceof HTMLDivElement) {
            return false;
        }
        return Boolean(
            isRadiobuttonOrCheckbox(element) ? element.checked : element.value,
        );
    }

    private getValue(element: ValidatableHTMLElement): string {
        if ("value" in element) {
            return element.value.trim();
        }
        return "";
    }

    private validateAll(
        element: ValidatableHTMLElement,
        validationState: ValidationState,
        validators: Validator[],
        validatorConfigs: ValidatorConfigs,
    ): AllValidatorsResult {
        if (validationState.serverError) {
            return {
                isValid: false,
                validationMessage: validationState.serverError,
            };
        }

        /* if the element is disabled we always consider it to be valid */
        if ("disabled" in element && element.disabled) {
            return {
                isValid: true,
                validationMessage: "",
            };
        }

        const value = this.getValue(element);

        const resultFromValidators = validators.map((validator) => {
            return {
                isValid: this.validate(
                    value,
                    element,
                    validator,
                    validatorConfigs,
                ),
                name: validator.name,
            };
        });

        const firstInvalidResult = resultFromValidators.find(
            (result) => !result.isValid,
        );

        if (firstInvalidResult) {
            const validationMessage = this.getErrorMessage(
                firstInvalidResult.name,
                validators,
                validatorConfigs,
                getElementType(element),
            );
            return { isValid: false, validationMessage };
        }
        return { isValid: true, validationMessage: "" };
    }

    private validate(
        value: string,
        element: ValidatableHTMLElement,
        validator: Validator,
        validatorConfigs: ValidatorConfigs,
    ): boolean {
        const validatorConfig = validatorConfigs[validator.name] ?? {};
        const isEnabled =
            validatorConfig.enabled === undefined || validatorConfig.enabled;

        /**
         * Only execute validation method if enabled is undefined or true.
         */
        return isEnabled
            ? validator.validation(value, element, validatorConfig)
            : true;
    }

    private getErrorMessage(
        validatorName: ValidatorName,
        validators: Validator[],
        validatorConfigs: ValidatorConfigs,
        elementType?: "text" | "radio" | "checkbox" | "select" | "textarea",
    ): string {
        const validatorConfig = validatorConfigs[validatorName];

        if (validatorConfig?.errorMessage) {
            return validatorConfig.errorMessage;
        }

        const candidates = getCandidates(
            validatorName,
            validators,
            elementType,
        );

        const key = candidates.find((candidate) =>
            isSet(this.validationErrorMessages[candidate]),
        );

        if (key) {
            return (
                this.validationErrorMessages[key] ?? validatorName.toUpperCase()
            );
        }

        return validatorName.toUpperCase();
    }

    private getElementsAffectedByValidity(
        element: ValidatableHTMLElement,
    ): ValidatableHTMLElement[] {
        if (element instanceof HTMLFieldSetElement) {
            return this.getValidatableElements(element).filter(
                (childElement: ValidatableHTMLElement) =>
                    childElement.closest("fieldset") === element,
            );
        }
        return [element];
    }

    private dispatchValidityEvent(
        element: ValidatableHTMLElement,
        validityEvent: ValidityEvent,
    ): void {
        const affectedElements: ValidatableHTMLElement[] =
            this.getElementsAffectedByValidity(element);

        const validField = validityEvent.validityMode === "ERROR";
        const event = new CustomEvent<ValidityEvent>("validity", {
            bubbles: true,
            detail: validityEvent,
        });

        for (const affectedElement of affectedElements) {
            if ("setCustomValidity" in affectedElement) {
                affectedElement.setCustomValidity(
                    validityEvent.validationMessage,
                );
            }
            affectedElement.setAttribute("aria-invalid", validField.toString());
        }

        element.dispatchEvent(event);
    }

    public clearAllStates(): void {
        this.validationStates = new Map();
    }
}

/**
 * @public
 */
export const ValidationService: ValidationServiceInterface =
    /* @__PURE__ */
    new ValidationServiceImpl();
