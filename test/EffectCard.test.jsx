import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import EffectCard from "../src/components/EffectCard.jsx";

const reverbParams = [
  { key: "mix", label: "MIX", min: 0, max: 1, step: 0.01, format: (v) => `${Math.round(v * 100)}%` },
  { key: "size", label: "SIZE", min: 0.5, max: 5, step: 0.1, format: (v) => `${v.toFixed(1)}s` },
];

describe("EffectCard — US18, US19, US20", () => {
  it("@us US18: shows title and OFF state by default", () => {
    render(
      <EffectCard
        title="Reverb"
        color="#00f5d4"
        settings={{ on: false, mix: 0.3, size: 2.0 }}
        onChange={() => {}}
        params={reverbParams}
      />
    );
    expect(screen.getByText("Reverb")).toBeInTheDocument();
    expect(screen.getByText("OFF")).toBeInTheDocument();
  });

  it("@us US18: clicking the title button toggles 'on' flag in settings", () => {
    const onChange = vi.fn();
    render(
      <EffectCard
        title="Reverb"
        color="#00f5d4"
        settings={{ on: false, mix: 0.3, size: 2.0 }}
        onChange={onChange}
        params={reverbParams}
      />
    );
    fireEvent.click(screen.getByText("Reverb"));
    expect(onChange).toHaveBeenCalledWith({ on: true, mix: 0.3, size: 2.0 });
  });

  it("@us US18: when on=true, label shows ON", () => {
    render(
      <EffectCard
        title="Reverb"
        color="#00f5d4"
        settings={{ on: true, mix: 0.3, size: 2.0 }}
        onChange={() => {}}
        params={reverbParams}
      />
    );
    expect(screen.getByText("ON")).toBeInTheDocument();
  });

  it("@us US18: each param renders as a labeled knob with formatted value", () => {
    render(
      <EffectCard
        title="Reverb"
        color="#00f5d4"
        settings={{ on: true, mix: 0.5, size: 2.0 }}
        onChange={() => {}}
        params={reverbParams}
      />
    );
    expect(screen.getByText("MIX")).toBeInTheDocument();
    expect(screen.getByText("SIZE")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByText("2.0s")).toBeInTheDocument();
  });
});
