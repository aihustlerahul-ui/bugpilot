'use client'

import { useState } from 'react'

interface OnboardingWizardModalProps {
  isOpen: boolean
  onClose: () => void
}

export function OnboardingWizardModal({ isOpen, onClose }: OnboardingWizardModalProps) {
  const [step, setStep] = useState(1)

  if (!isOpen) return null

  const steps = [
    {
      num: 1,
      title: 'Pin Chrome Extension',
      desc: 'Install and pin the BugPilot extension to start capturing screenshot and session replay bugs with 1 click.',
      badge: 'Capture Setup',
      icon: '🧩',
    },
    {
      num: 2,
      title: 'Configure Your Project',
      desc: 'Set your web application URL, staging domains, and custom CSS selector rules for automated diagnostics.',
      badge: 'Project Setup',
      icon: '⚙️',
    },
    {
      num: 3,
      title: 'Connect Integrations',
      desc: 'Link Azure DevOps, Atlassian Jira Cloud, Linear, or Slack for 2-way sync and instant team alerts.',
      badge: 'Sync & Alerts',
      icon: '🔗',
    },
    {
      num: 4,
      title: 'AI Diagnostic & Test Gen',
      desc: 'Leverage AI Root Cause Analysis and 1-click Playwright test script (.spec.ts) generation from user sessions.',
      badge: 'AI Copilot',
      icon: '✨',
    },
  ]

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-fade-in">
      <div className="bg-white rounded-2xl shadow-2xl border border-gray-100 max-w-lg w-full overflow-hidden">
        {/* Progress Bar */}
        <div className="h-1.5 w-full bg-gray-100">
          <div
            className="h-full bg-indigo-600 transition-all duration-300 ease-out"
            style={{ width: `${(step / steps.length) * 100}%` }}
          />
        </div>

        {/* Content Body */}
        <div className="p-7">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700">
              {steps[step - 1].badge} • Step {step} of {steps.length}
            </span>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 text-lg font-bold"
            >
              &times;
            </button>
          </div>

          <div className="mt-5 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-50 text-3xl shadow-xs">
              {steps[step - 1].icon}
            </div>
            <h3 className="mt-4 text-lg font-bold text-gray-900">
              {steps[step - 1].title}
            </h3>
            <p className="mt-2 text-sm text-gray-600 leading-relaxed max-w-sm mx-auto">
              {steps[step - 1].desc}
            </p>
          </div>

          {/* Stepper Dots */}
          <div className="mt-6 flex justify-center gap-2">
            {steps.map((s) => (
              <button
                key={s.num}
                onClick={() => setStep(s.num)}
                className={`h-2 rounded-full transition-all ${
                  step === s.num ? 'w-6 bg-indigo-600' : 'w-2 bg-gray-200 hover:bg-gray-300'
                }`}
              />
            ))}
          </div>

          {/* Action Buttons */}
          <div className="mt-7 flex items-center justify-between pt-4 border-t border-gray-100">
            <button
              onClick={() => (step > 1 ? setStep(step - 1) : onClose())}
              className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
            >
              {step > 1 ? 'Back' : 'Skip Setup'}
            </button>
            <button
              onClick={() => (step < steps.length ? setStep(step + 1) : onClose())}
              className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold shadow-xs transition-colors"
            >
              {step < steps.length ? 'Next Step →' : 'Finish & Get Started 🚀'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
