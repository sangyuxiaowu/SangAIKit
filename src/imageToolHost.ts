import type { ResponsesTool } from './openai';
import type { SessionImage } from './sessionTypes';

export interface ImageToolSchemaExtension {
  description: string;
  properties: Record<string, Record<string, unknown>>;
  required?: string[];
  optional?: string[];
}

export interface ImageToolResult {
  images: Blob[];
  model: string;
  prompt?: string;
}

export interface ImageToolExtension extends ImageToolSchemaExtension {
  prepare: (args: Record<string, unknown>, signal: AbortSignal) => Promise<{
    inputImage?: Blob;
    inputImages?: Blob[];
    complete: (result: ImageToolResult, signal: AbortSignal) => Promise<unknown>;
  }>;
}

export type ImageToolExtensions<T = ImageToolSchemaExtension> = {
  generate_image?: T;
  remove_background?: T;
};

export class ImageApplicationError extends Error {
  constructor(message: string, cause: unknown) {
    super(message, { cause });
    this.name = 'ImageApplicationError';
  }
}

export function extendImageToolDefinition<T extends Pick<ResponsesTool, 'name' | 'description' | 'parameters'>>(definition: T, extension?: ImageToolSchemaExtension): T {
  if (!extension) return definition;
  const properties = definition.parameters.properties as Record<string, unknown>;
  for (const key of Object.keys(extension.properties)) {
    if (Object.hasOwn(properties, key)) throw new Error(`Image tool parameter ${key} conflicts with a built-in parameter.`);
  }
  const required = definition.parameters.required as string[] | undefined;
  for (const key of extension.optional ?? []) {
    if (!required?.includes(key)) throw new Error(`Image tool parameter ${key} is not required.`);
  }
  for (const key of extension.required ?? []) {
    if (!Object.hasOwn(extension.properties, key)) throw new Error(`Unknown required host parameter ${key}.`);
  }
  return {
    ...definition,
    description: extension.description,
    parameters: { ...definition.parameters, properties: { ...properties, ...extension.properties },
      required: [...(required ?? []).filter(key => !extension.optional?.includes(key)), ...(extension.required ?? [])] }
  };
}

export async function deliverImageResult(
  prepared: Awaited<ReturnType<ImageToolExtension['prepare']>>,
  result: ImageToolResult,
  signal: AbortSignal,
  saveImage?: (blob: Blob, name: string) => Promise<SessionImage>,
  onImage?: (image: SessionImage) => void,
  archivedImages?: SessionImage[]
): Promise<unknown> {
  try {
    signal.throwIfAborted();
    return await prepared.complete(result, signal);
  } catch (error) {
    if (signal.aborted) throw error;
    const saved: SessionImage[] = archivedImages ?? [];
    let recoveryError: unknown;
    if (saveImage && !archivedImages) {
      try {
        for (const [index, blob] of result.images.entries()) {
          const extension = blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/webp' ? 'webp' : 'png';
          const image = await saveImage(blob, `recovery-${Date.now()}-${index + 1}.${extension}`);
          saved.push(image);
          onImage?.(image);
        }
      } catch (failure) { recoveryError = failure; }
    }
    const detail = error instanceof Error ? error.message : String(error);
    const recovery = saved.length ? `Recovery image IDs: ${saved.map(image => image.id).join(', ')}.` : 'No recovery images were saved.';
    const failure = recoveryError ? ` Recovery saving failed: ${recoveryError instanceof Error ? recoveryError.message : String(recoveryError)}.` : '';
    throw new ImageApplicationError(`Image processing succeeded but host application failed: ${detail}. ${recovery}${failure} Do not automatically repeat image processing.`, error);
  }
}
