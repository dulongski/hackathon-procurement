export default function AboutPage() {
  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">About ChainIQ</h1>
      <p className="text-gray-500 mb-8">AI-powered procurement sourcing agent</p>

      <div className="space-y-6">
        <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-2">What is ChainIQ?</h2>
          <p className="text-sm text-gray-600 leading-relaxed">
            ChainIQ is an intelligent procurement sourcing agent that automates the evaluation of
            purchase requests. It applies organizational policies, evaluates supplier fit, assesses
            risk, and produces actionable recommendations -- all in seconds.
          </p>
        </section>

        <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-3">Multi-Agent Architecture</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              { name: "Historical Agent", desc: "Analyzes past procurement awards and supplier track records" },
              { name: "Risk Agent", desc: "Evaluates compliance, geopolitical, and operational risk factors" },
              { name: "Value Agent", desc: "Assesses pricing competitiveness and total cost of ownership" },
              { name: "Strategic Agent", desc: "Considers long-term supplier relationships and strategic alignment" },
            ].map((agent) => (
              <div key={agent.name} className="p-4 bg-gray-50 rounded-lg">
                <p className="text-sm font-semibold text-gray-800">{agent.name}</p>
                <p className="text-xs text-gray-500 mt-1">{agent.desc}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-2">Pipeline Steps</h2>
          <ol className="space-y-2 text-sm text-gray-600 list-decimal list-inside">
            <li>Request interpretation and field extraction</li>
            <li>Validation and completeness checks</li>
            <li>Policy evaluation (thresholds, preferred suppliers, restrictions)</li>
            <li>Supplier filtering, scoring, and shortlisting</li>
            <li>Multi-agent opinion gathering</li>
            <li>Confidence scoring and dynamic weight adjustment</li>
            <li>Escalation detection</li>
            <li>Final recommendation and approval routing</li>
          </ol>
        </section>
      </div>
    </div>
  );
}
