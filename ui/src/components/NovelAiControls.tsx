import { useState } from "react";
import { useI18n } from "../i18n";
import { useAppStore } from "../store/useAppStore";
import type { NovelAiCharacterPrompt, NovelAiGenerationOptions } from "../types";

function SliderField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="novelai-slider">
      <span>{label}<output>{value}</output></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

const characterPositionOptions: NovelAiCharacterPrompt["position"][] = ["left", "center", "right"];

export function NovelAiControls() {
  const { t } = useI18n();
  const options = useAppStore((state) => state.novelAiOptions);
  const setOptions = useAppStore((state) => state.setNovelAiOptions);
  const referenceCount = useAppStore((state) => state.referenceImages.length);
  const [promptTab, setPromptTab] = useState<"prompt" | "negative">("negative");

  const patchCharacter = (index: number, patch: Partial<NovelAiCharacterPrompt>) => {
    setOptions({ characters: options.characters.map((character, characterIndex) => characterIndex === index ? { ...character, ...patch } : character) });
  };
  const addCharacter = () => {
    if (options.characters.length >= 6) return;
    setOptions({ characters: [...options.characters, { prompt: "", negativePrompt: "", position: "center" }] });
  };
  const removeCharacter = (index: number) => {
    setOptions({ characters: options.characters.filter((_, characterIndex) => characterIndex !== index) });
  };
  const select = <K extends keyof NovelAiGenerationOptions>(key: K, value: NovelAiGenerationOptions[K]) => setOptions({ [key]: value });

  return (
    <div className="novelai-controls">
      <section className="novelai-card" aria-labelledby="novelai-prompt-title">
        <div className="novelai-card__header">
          <div>
            <h3 id="novelai-prompt-title">{t("novelai.promptTitle")}</h3>
            <p>{t("novelai.promptHelp")}</p>
          </div>
        </div>
        <div className="novelai-tabs" role="tablist" aria-label={t("novelai.promptTitle")}>
          <button type="button" role="tab" aria-selected={promptTab === "prompt"} className={promptTab === "prompt" ? "active" : ""} onClick={() => setPromptTab("prompt")}>{t("novelai.positiveTab")}</button>
          <button type="button" role="tab" aria-selected={promptTab === "negative"} className={promptTab === "negative" ? "active" : ""} onClick={() => setPromptTab("negative")}>{t("novelai.negativeTab")}</button>
        </div>
        {promptTab === "negative" ? (
          <textarea
            className="novelai-textarea"
            value={options.negativePrompt}
            onChange={(event) => setOptions({ negativePrompt: event.target.value })}
            placeholder={t("novelai.negativePlaceholder")}
            aria-label={t("novelai.negativeTab")}
          />
        ) : <p className="novelai-inline-help">{t("novelai.positiveHelp")}</p>}
        <label className="novelai-field">
          <span>{t("novelai.ucPreset")}</span>
          <select value={options.ucPreset} onChange={(event) => select("ucPreset", event.target.value as NovelAiGenerationOptions["ucPreset"])}>
            {(["heavy", "light", "human", "furry", "none"] as const).map((value) => <option key={value} value={value}>{t(`novelai.uc.${value}`)}</option>)}
          </select>
        </label>
      </section>

      <section className="novelai-card" aria-labelledby="novelai-characters-title">
        <div className="novelai-card__header">
          <div><h3 id="novelai-characters-title">{t("novelai.characters")}</h3><p>{t("novelai.charactersHelp")}</p></div>
          <button type="button" className="novelai-add" onClick={addCharacter} disabled={options.characters.length >= 6} aria-label={t("novelai.addCharacter")}>＋</button>
        </div>
        {options.characters.map((character, index) => (
          <div className="novelai-character" key={index}>
            <div className="novelai-character__title"><strong>{t("novelai.characterN", { n: index + 1 })}</strong><button type="button" onClick={() => removeCharacter(index)}>{t("common.remove")}</button></div>
            <textarea className="novelai-textarea" value={character.prompt} onChange={(event) => patchCharacter(index, { prompt: event.target.value })} placeholder={t("novelai.characterPromptPlaceholder")} />
            <textarea className="novelai-textarea novelai-textarea--small" value={character.negativePrompt} onChange={(event) => patchCharacter(index, { negativePrompt: event.target.value })} placeholder={t("novelai.characterNegativePlaceholder")} />
            <div className="novelai-position" role="group" aria-label={t("novelai.positionLabel")}>
              {characterPositionOptions.map((position) => <button type="button" key={position} className={character.position === position ? "active" : ""} onClick={() => patchCharacter(index, { position })}>{t(`novelai.position.${position}`)}</button>)}
            </div>
          </div>
        ))}
      </section>

      <section className="novelai-card" aria-labelledby="novelai-reference-title">
        <div className="novelai-card__header"><div><h3 id="novelai-reference-title">{t("novelai.referenceTitle")}</h3><p>{t("novelai.referenceHelp", { n: referenceCount })}</p></div></div>
        <label className="novelai-field">
          <span>{t("novelai.referenceMode")}</span>
          <select value={options.referenceMode} onChange={(event) => select("referenceMode", event.target.value as NovelAiGenerationOptions["referenceMode"])}>
            <option value="none">{t("novelai.reference.none")}</option>
            <option value="img2img">{t("novelai.reference.img2img")}</option>
            <option value="vibe">{t("novelai.reference.vibe")}</option>
            <option value="precise-character">{t("novelai.reference.preciseCharacter")}</option>
            <option value="precise-style">{t("novelai.reference.preciseStyle")}</option>
            <option value="precise-character-style">{t("novelai.reference.preciseBoth")}</option>
          </select>
        </label>
        {options.referenceMode === "img2img" ? <>
          <SliderField label={t("novelai.img2imgStrength")} value={options.img2imgStrength} min={0.01} max={0.99} step={0.01} onChange={(value) => setOptions({ img2imgStrength: value })} />
          <SliderField label={t("novelai.img2imgNoise")} value={options.img2imgNoise} min={0} max={1} step={0.01} onChange={(value) => setOptions({ img2imgNoise: value })} />
        </> : options.referenceMode !== "none" ? <>
          <SliderField label={t("novelai.referenceStrength")} value={options.referenceStrength} min={-1} max={1} step={0.05} onChange={(value) => setOptions({ referenceStrength: value })} />
          <SliderField label={t("novelai.informationExtracted")} value={options.referenceInformationExtracted} min={0} max={1} step={0.05} onChange={(value) => setOptions({ referenceInformationExtracted: value })} />
          {options.referenceMode.startsWith("precise-") ? <SliderField label={t("novelai.fidelity")} value={options.referenceFidelity} min={-1} max={1} step={0.05} onChange={(value) => setOptions({ referenceFidelity: value })} /> : null}
        </> : null}
      </section>

      <details className="novelai-card novelai-advanced">
        <summary>{t("novelai.advanced")}</summary>
        <div className="novelai-grid">
          <label className="novelai-field"><span>{t("novelai.sampler")}</span><select value={options.sampler} onChange={(event) => select("sampler", event.target.value as NovelAiGenerationOptions["sampler"])}><option value="k_euler_ancestral">Euler Ancestral</option><option value="k_euler">Euler</option><option value="k_dpmpp_2s_ancestral">DPM++ 2S Ancestral</option><option value="k_dpmpp_2m">DPM++ 2M</option><option value="k_dpmpp_sde">DPM++ SDE</option></select></label>
          <label className="novelai-field"><span>{t("novelai.noiseSchedule")}</span><select value={options.noiseSchedule} onChange={(event) => select("noiseSchedule", event.target.value as NovelAiGenerationOptions["noiseSchedule"])}><option value="karras">Karras</option><option value="native">Native</option><option value="exponential">Exponential</option><option value="polyexponential">Polyexponential</option></select></label>
        </div>
        <SliderField label={t("novelai.steps")} value={options.steps} min={1} max={50} step={1} onChange={(value) => setOptions({ steps: value })} />
        <SliderField label={t("novelai.guidance")} value={options.scale} min={0} max={10} step={0.1} onChange={(value) => setOptions({ scale: value })} />
        <SliderField label={t("novelai.cfgRescale")} value={options.cfgRescale} min={0} max={1} step={0.05} onChange={(value) => setOptions({ cfgRescale: value })} />
        <div className="novelai-grid">
          <label className="novelai-field"><span>{t("novelai.seed")}</span><input type="number" min={0} max={4294967295} placeholder={t("novelai.random")} value={options.seed ?? ""} onChange={(event) => setOptions({ seed: event.target.value === "" ? null : Number(event.target.value) })} /></label>
          <label className="novelai-field"><span>SMEA</span><select value={options.smea} onChange={(event) => select("smea", event.target.value as NovelAiGenerationOptions["smea"])}><option value="off">Off</option><option value="auto">Auto</option><option value="smea">SMEA</option><option value="dynamic">SMEA DYN</option></select></label>
        </div>
        <label className="novelai-check"><input type="checkbox" checked={options.qualityTags} onChange={(event) => setOptions({ qualityTags: event.target.checked })} /><span>{t("novelai.qualityTags")}</span></label>
        <label className="novelai-check"><input type="checkbox" checked={options.decrisper} onChange={(event) => setOptions({ decrisper: event.target.checked })} /><span>{t("novelai.decrisper")}</span></label>
      </details>
    </div>
  );
}
